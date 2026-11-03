#!/bin/sh
# Cloudflare Pages 用：公開するファイルだけを dist/ にまとめる。
# 依存関係のインストールや外部からのダウンロードは行わない。
set -eu
cd "$(dirname "$0")"
rm -rf dist
mkdir dist
cp index.html app.js styles.css _headers dist/
echo "dist/ に $(ls dist | wc -l | tr -d ' ') 個のファイルを用意しました"
