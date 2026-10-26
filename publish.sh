#!/bin/zsh
# 원본 정리본을 암호화해서 GitHub Pages에 올린다.  사용: ./publish.sh "변경 내용"
set -e
cd "$(dirname "$0")"
node tools/build.mjs
git add -A
git commit -m "${1:-정리본 업데이트}"
git push
