#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""agents-home-tech-demo 图片替换脚本
用法: python3 replace_imgs.py <agents-home-tech-demo-20260925.html 路径>
将页面 IMG_ASSETS 中 7 个 key 的 base64 图片替换为本目录 base64/*.b64.txt 的新图。
替换前自动备份原文件为 <原文件名>.bak-<时间戳>。
"""
import base64, re, shutil, sys, os, time

KEYS = ['palu','hwRec','hwRobot','courseAgent','courseWb','opcLlm','opcComic']

def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    path = sys.argv[1]
    html = open(path, encoding='utf-8').read()
    backup = path + '.bak-' + time.strftime('%Y%m%d-%H%M%S')
    shutil.copy2(path, backup)
    total = 0
    for k in KEYS:
        b64 = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'base64', k + '.b64.txt')).read().strip()
        # key 可带引号或不带引号（hwRec 等 4 个无引号）
        pat = re.compile(r'(?<![\w"])(' + re.escape(k) + r'"\s*:\s*"|(?<![\w"])' + re.escape(k) + r'\s*:\s*")(/9j/[^"]+)(")')
        html, n = pat.subn(lambda m: m.group(1) + b64 + m.group(3), html)
        total += n
        print(f'{k}: replaced {n} occurrence(s)')
    if total != len(KEYS):
        print(f'WARNING: expected {len(KEYS)} replacements, got {total}. 原文件已备份，请人工核对。')
    open(path, 'w', encoding='utf-8').write(html)
    print(f'Done. backup at {backup}')

if __name__ == '__main__':
    main()
