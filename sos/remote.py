#!/usr/bin/env python3
#
# This file is part of Script of Scripts (sos), a workflow system
# for the execution of commands and scripts in different languages.
# Please visit https://github.com/vatlab/SOS for more information.
#
# Copyright (C) 2016 Bo Peng (bpeng@mdanderson.org)
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <http://www.gnu.org/licenses/>.
#
from .utils import env
from .sos_eval import interpolate
import subprocess
from collections.abc import Sequence

class RemoteHost:
    '''A remote host class that manages how to communicate with remote host'''
    def __init__(self, alias, path_map=None):
        self.alias = alias
        self.address = self._get_address()
        self.path_map = self._get_path_map(path_map)
        self.send_cmd = self._get_send_cmd()
        self.receive_cmd = self._get_receive_cmd()
        self.execute_cmd = self._get_execute_cmd()

    def _get_address(self):
        if 'hosts' not in env.sos_dict['CONFIG'] or \
            self.alias not in env.sos_dict['CONFIG']['hosts'] or \
            'address' not in env.sos_dict['CONFIG']['hosts'][self.alias]: 
            return self.alias
        else:
            return env.sos_dict['CONFIG']['hosts'][self.alias]['address']
        
    def _get_path_map(self, path_map=None):
        res = {}
        # if user-specified path_map, it overrides CONFIG
        if path_map is None:
            # if not on_host, no conversion drive map et al
            if 'on_host' not in env.sos_dict['_runtime']:
                return {}
            if self.alias in env.sos_dict['CONFIG']['hosts'] and \
                'path_map' in env.sos_dict['CONFIG']['hosts'][self.alias]:
                path_map = env.sos_dict['CONFIG']['hosts'][self.alias]['path_map']
        #
        if isinstance(path_map, str):
            path_map = [path_map]
        if isinstance(path_map, Sequence):
            for v in path_map:
                if ':' not in v:
                    raise ValueError('Path map should be separated as from:to, {} specified'.format(v))
                elif v.count(':') > 1:
                    raise ValueError('Path map should be separated as from:to, {} specified'.format(v))
                res[v.split(':')[0]] = v.split(':')[1]
        elif isinstance(path_map, dict):
            for k,v in path_map.items():
                res[k] = v
        else:
            raise ValueError('Unacceptable path_mapue for configuration path_map: {}'.format(path_map))
        return res

    def _get_send_cmd(self):
        if 'hosts' not in env.sos_dict['CONFIG'] or \
            self.alias not in env.sos_dict['CONFIG']['hosts'] or \
            'send_cmd' not in env.sos_dict['CONFIG']['hosts'][self.alias]: 
            return 'rsync -av ${{source!aq}} {}:${{dest!qd}}'.format(self.address)
        else:
            return env.sos_dict['CONFIG']['hosts'][self.alias]['send_cmd']

    def _get_receive_cmd(self):
        if 'hosts' not in env.sos_dict['CONFIG'] or \
            self.alias not in env.sos_dict['CONFIG']['hosts'] or \
            'receive_cmd' not in env.sos_dict['CONFIG']['hosts'][self.alias]: 
            return 'rsync -av {}:${{source!aq}} ${{dest!qd}}'.format(self.address)
        else:
            return env.sos_dict['CONFIG']['hosts'][self.alias]['receive_cmd']

    def _get_execute_cmd(self):
        if 'hosts' not in env.sos_dict['CONFIG'] or \
            self.alias not in env.sos_dict['CONFIG']['hosts'] or \
            'execute_cmd' not in env.sos_dict['CONFIG']['hosts'][self.alias]: 
            return 'ssh {} "bash --login -c \'${{cmd}}\'"'.format(self.address)
        else:
            return env.sos_dict['CONFIG']['hosts'][self.alias]['execute_cmd']

    def map_path(self, source):
        dest = source
        for k,v in self.path_map.items():
            if dest.startswith(k):
                dest = v + dest[len(k):]
        return dest

    def send_to_host(self, items):
        transfer = {}
        if isinstance(items, str):
            transfer[items] = self.map_path(items)
        elif isinstance(items, Sequence):
            for item in items:
                transfer[item] = self.map_path(item)
        else:
            raise ValueError('Unacceptable parameter {} to option to_host'.format(items))

        for source, dest in transfer.items():
            env.logger.info('Sending ``{}`` to {} as {}'.format(source, self.alias, dest))
            cmd = interpolate(self.send_cmd, '${ }', {'source': source, 'dest': dest, 'host': self.address})
            env.logger.debug(cmd)
            ret = subprocess.call(cmd, shell=True, stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
            if (ret != 0):
                raise RuntimeError('Failed to copy {} to {}'.format(source, self.alias))

    def receive_from_host(self, items):
        transfer = {}
        if isinstance(items, str):
            transfer[self.map_path(items)] = items
        elif isinstance(items, Sequence):
            for item in items:
                transfer[self.map_path(item)] = item
        else:
            raise ValueError('Unacceptable parameter {} to function from_host'.format(items))
        #
        for source, dest in transfer.items():
            env.logger.info('Receiving ``{}`` from {} as {}'.format(dest, self.alias, source))
            cmd = interpolate(self.receive_cmd, '${ }', {'source': source, 'dest': dest, 'host': self.address})
            try:
                ret = subprocess.call(cmd, shell=True, stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
                if (ret != 0):
                    raise RuntimeError('Failed to copy {} from {}'.format(source, self.alias))
            except Exception as e:
                raise  RuntimeError('Failed to copy {} from {}: {}'.format(source, self.alias, e))

    def execute_task(self, task):
        cmd = interpolate(self.execute_cmd, '${ }', {'cmd': 'sos execute -e ~/{}'.format(task)})
        env.logger.info('Executing job ``{}``'.format(cmd))
        env.logger.debug(cmd)
        ret = subprocess.call(cmd, shell=True)
        if (ret != 0):
            raise RuntimeError('Failed to execute {}'.format(cmd))