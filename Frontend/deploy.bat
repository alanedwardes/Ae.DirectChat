@echo off
call build.bat
aws s3 cp dist/bundle.js      s3://ae-chat --acl public-read --cache-control no-cache --content-type application/javascript
aws s3 cp dist/bundle.js.map  s3://ae-chat --acl public-read --cache-control no-cache --content-type application/json
aws s3 cp dist/index.html     s3://ae-chat --acl public-read --cache-control no-cache --content-type text/html
aws s3 cp dist/robots.txt     s3://ae-chat --acl public-read --cache-control no-cache --content-type text/plain
aws s3 cp dist/style.css      s3://ae-chat --acl public-read --cache-control no-cache --content-type text/css
pause
