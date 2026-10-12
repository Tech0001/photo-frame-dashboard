#!/usr/bin/env python3
"""Publish a bounded, selected project report. No remote shell or model calls."""
import argparse
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

LIMIT = 128 * 1024

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def load_json(path):
    with open(path, 'rb') as stream:
        raw = stream.read(LIMIT + 1)
    if len(raw) > LIMIT:
        raise ValueError('Report or configuration is too large.')
    return json.loads(raw)

def selected(report):
    # Report-only fields: never forward raw transcripts, paths, credentials or
    # private evidence objects accidentally bundled beside the report.
    out = {key: report.get(key) for key in ('schemaVersion', 'project', 'source', 'updatedAt', 'objective', 'next')}
    for key in ('work', 'recent', 'blockers', 'decisions'):
        rows = report.get(key)
        if not isinstance(rows, list) or len(rows) > 24:
            raise ValueError('Each report list must contain at most 24 items.')
        fields = ('id', 'title', 'owner', 'detail') + (('stages',) if key == 'work' else ('stage', 'at') if key == 'recent' else ('next',))
        out[key] = [{field: row.get(field) for field in fields} for row in rows]
        if key == 'work':
            for row in out[key]:
                row['stages'] = {stage: (row['stages'] or {}).get(stage) for stage in ('built', 'reviewed', 'integrated', 'live')}
    return out

def publish(config):
    hub = urllib.parse.urlsplit(config['hub'])
    if hub.scheme not in ('http', 'https') or not hub.netloc or hub.username or hub.password or hub.query or hub.fragment:
        raise ValueError('Use the hub HTTP(S) address without login details or query parameters.')
    token_path = Path(config['tokenFile']).expanduser()
    meta = token_path.stat()
    if meta.st_uid != os.getuid() or stat.S_IMODE(meta.st_mode) & 0o077:
        raise ValueError('The progress token file must belong to this user and have mode 0600.')
    token = token_path.read_text().strip()
    if not 16 <= len(token) <= 256 or any(ord(c) < 33 or ord(c) > 126 for c in token):
        raise ValueError('The progress token file is invalid.')
    if bool(config.get('report')) == bool(config.get('exporter')):
        raise ValueError('Configure exactly one report file or exporter command.')
    if config.get('exporter'):
        command = config['exporter']
        if not isinstance(command, list) or not command or not all(isinstance(x, str) and x for x in command):
            raise ValueError('The exporter must be an argument list, without shell expansion.')
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30, check=True)
        if len(result.stdout) > LIMIT:
            raise ValueError('Exporter report is too large.')
        report = json.loads(result.stdout)
    else:
        report = load_json(Path(config['report']).expanduser())
    body = json.dumps(selected(report), ensure_ascii=False).encode()
    if len(body) > LIMIT:
        raise ValueError('Selected report is too large.')
    url = config['hub'].rstrip('/') + '/api/progress/evergreen'
    request = urllib.request.Request(url, data=body, method='PUT', headers={'Content-Type': 'application/json', 'X-Progress-Token': token})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=15) as response:
        answer = json.loads(response.read(4096))
    if answer.get('ok') is not True:
        raise ValueError('The hub did not accept the report.')
    print('Evergreen report published: ' + str(answer.get('updatedAt', '')))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, help='Publisher configuration JSON')
    args = parser.parse_args()
    try:
        publish(load_json(Path(args.config).expanduser()))
    except urllib.error.HTTPError as error:
        print('Evergreen sync rejected (HTTP %s). Check the report format and token.' % error.code, file=sys.stderr)
        return 1
    except (OSError, ValueError, TypeError, KeyError, AttributeError, subprocess.SubprocessError):
        print('Evergreen sync failed. Check the source, configuration and hub connection.', file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())
