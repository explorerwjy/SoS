// This file is part of Script of Scripts (sos), a workflow system
// for the execution of commands and scripts in different languages.
// Please visit https://github.com/bpeng2000/SOS for more information.
//
// Copyright (C) 2016 Bo Peng (bpeng@mdanderson.org)
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program. If not, see <http://www.gnu.org/licenses/>.
// override the existing execute function by
// look for all input cells, find one that has prompt '*', which must
// be the one that is being executed. Then, get the metadata and send
// the kernel and cell index through the %frontend magic.
//
var my_execute = function(code, callbacks, options) {
    "use strict"
    var cells = IPython.notebook.get_cells();
    for (var i = cells.length - 1; i >= 0; --i) {
        // this is the cell that is being executed...
        // according to this.set_input_prompt('*') before execute is called.
        // also, because a cell might be starting without a previous cell
        // being finished, we should start from reverse and check actual code
        if (cells[i].input_prompt_number == '*' && code == cells[i].get_text()) {
            // use cell kernel if meta exists, otherwise use window.default_kernel
            return this.orig_execute(
                // passing to kernel
                // 1. the default kernel (might have been changed from menu bar
                // 2. cell kernel (might be unspecified for new cell)
                // 3. cell index (for setting style after execution)
                // in addition, the frontend command will send a "--list-kernel" request if
                // the frontend is not correctly initialized, possibly because the kernel was
                // not ready when the frontend sent the command `%listkernel`.
                "%frontend " +
                (window.kernel_updated ? "" : " --list-kernel ") +
                (window.my_panel.displayed ? " --use-panel" : "") +
                " --default-kernel " + window.default_kernel +
                " --cell-kernel " + cells[i].metadata.kernel +
                " --cell " + i.toString() + "\n" + code,
                callbacks, options)
        }
    }
    // if this is a command from scratch pad (not part of the notebook)
    return this.orig_execute(
        "%frontend " +
        (window.kernel_updated ? "" : " --list-kernel ") +
        " --default-kernel " + window.default_kernel +
        " --cell-kernel " + window.my_panel.cell.metadata.kernel +
        " --cell -1 " + "\n" + code,
        callbacks, {
            'silent': false,
            'store_history': false
        })
}

function register_sos_comm() {
    // comm message sent from the kernel
    Jupyter.notebook.kernel.comm_manager.register_target('sos_comm',
        function(comm, msg) {
            comm.on_msg(function(msg) {
                // when the notebook starts it should receive a message in the format of
                // a nested array of elements such as
                //
                // "ir", "R", "#ABackgroundColorDEF"
                //
                // where are kernel name (jupyter kernel), displayed name (SoS), and background
                // color assigned by the language module. The user might use name ir or R (both
                // acceptable) but the frontend should only display displayed name, and send
                // the real kernel name back to kernel (%frontend and metadata).
                //
                // there are two kinds of messages from my_execute
                // 1. cell_idx: kernel
                //     the kernel used for the cell with source
                // 2. None: kernel
                //     the kernel for the new cell

                var data = msg.content.data;
                var msg_type = msg.metadata.msg_type;

                if (msg_type == 'kernel-list') {
                    if (window.kernel_updated)
                        return;
                    for (var i = 0; i < data.length; i++) {
                        // BackgroundColor is color
                        BackgroundColor[data[i][0]] = data[i][2];
                        BackgroundColor[data[i][1]] = data[i][2];
                        // DisplayName
                        DisplayName[data[i][0]] = data[i][1];
                        DisplayName[data[i][1]] = data[i][1];
                        // Name
                        KernelName[data[i][0]] = data[i][0];
                        KernelName[data[i][1]] = data[i][0];
                        // KernelList, use displayed name
                        if (KernelList.findIndex((item) => item[0] === data[i][1]) == -1)
                            KernelList.push([data[i][1], data[i][1]]);
                        // if the kernel is not in metadata, push it in
                        var k_idx = IPython.notebook.metadata['sos']['kernels'].findIndex((item) => item[0] === data[i][0])
                        if (k_idx == -1)
                            IPython.notebook.metadata['sos']['kernels'].push(data[i])
                        else {
                            // if language exist update the display name and color, in case it was using old ones
                            IPython.notebook.metadata['sos']['kernels'][k_idx][1] = data[i][1];
                            IPython.notebook.metadata['sos']['kernels'][k_idx][2] = data[i][2];
                        }
                    }
                    //add dropdown menu of kernels in frontend
                    load_select_kernel();
                    window.kernel_updated = true;
                } else if (msg_type == 'default-kernel') {
                    // update the cells when the notebook is being opened.
                    // we also set a global kernel to be used for new cells
                    $('#kernel_selector').val(DisplayName[data]);
                    // a side effect of change is cells without metadata kernel info will change background
                    $('#kernel_selector').change();
                } else if (msg_type == 'cell-kernel') {
                    // get cell from passed cell index, which was sent through the
                    // %frontend magic
                    if (data[0] == -1)
                        var cell = window.my_panel.cell;
                    else
                        var cell = IPython.notebook.get_cell(data[0]);
                    if (cell.metadata.kernel != KernelName[data[1]]) {
                        cell.metadata.kernel = KernelName[data[1]];
                        // set meta information
                        changeStyleOnKernel(cell, data[1])
                    }
                } else if (msg_type == 'preview-input') {
                    cell = window.my_panel.cell;
                    cell.clear_input();
                    cell.set_text(data);
                    cell.clear_output();
                } else if (msg_type == 'preview-kernel') {
                    changeStyleOnKernel(window.my_panel.cell, data);
                } else {
                    // this is preview output
                    cell = window.my_panel.cell;
                    data.output_type = msg_type;
                    cell.output_area.append_output(data);
                    /*
                    if (msg_type === 'display_data')
                        cell.output_area.append_display_data(data);
                    else if (msg_type === 'stream')
                        cell.output_area.append_stream(data);
                    else
                        cell.output_area.append_stream('Unknown msg type ' + msg_type + '\nPlease notify maintainer of SoS of this bug.');
                    */
                    // remove output prompt
                    var op = cell.element[0].getElementsByClassName('out_prompt_overlay');
                    if (op.length > 0)
                        op[0].parentNode.removeChild(op[0]);
                    var op = cell.element[0].getElementsByClassName('prompt');
                    if (op.length > 0)
                        op[0].parentNode.removeChild(op[0]);

                    cell.output_area.expand();
                }
            });
        }
    );
}


function wrap_execute() {
    if (!window.kernel_updated)
        IPython.notebook.kernel.execute('%frontend --list-kernel', [], {
            'silent': true,
            'store_history': false
        });
    // override kernel execute with the wrapper.
    IPython.notebook.kernel.orig_execute = IPython.notebook.kernel.execute
    IPython.notebook.kernel.execute = my_execute
}