#!/usr/bin/env bash
set -e
TOKEN=$(cat ~/hoy-portal/HoY\ Internportal/hubspot-token.txt)
PID=395642784977

curl -sH "Authorization: Bearer $TOKEN" "https://api.hubapi.com/cms/v3/pages/site-pages/$PID" | python3 -c "
import json,sys
p = json.load(sys.stdin)
print('name:', p.get('name'))
print('slug:', p.get('slug'))
print('state:', p.get('state'))
print('currentState:', p.get('currentState'))
print('archived:', p.get('archived'))
print('publishDate:', p.get('publishDate'))
print('updatedAt:', p.get('updatedAt'))
print('url:', p.get('url'))
print('absolute_url:', p.get('absoluteUrl'))
print('language:', p.get('language'))
"
