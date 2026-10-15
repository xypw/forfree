#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 ForFree 应用图标。
纯标准库实现：手写 PNG 编码 + 手写 ICO 容器，不依赖 Pillow 等第三方库。
图形：圆角方形渐变底 + 白色 W 字标（用线段距离场光栅化，自带抗锯齿）。
"""
import os, struct, zlib, math

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build')

# 品牌渐变：左上 -> 右下
C1 = (240, 96, 63)    # #F0603F
C2 = (201, 44, 32)    # #C92C20

# 字标「F」的笔画（归一化坐标，y 向下）。
# 每一笔是一条折线；渲染时按「到线段的距离」光栅化，自带抗锯齿。
GLYPH = [
    [(0.335, 0.250), (0.335, 0.750)],   # 竖
    [(0.335, 0.250), (0.705, 0.250)],   # 上横
    [(0.335, 0.500), (0.625, 0.500)],   # 中横
]
W_HALF = 0.056        # 笔画半宽（归一化）
RADIUS = 0.225        # 圆角半径（归一化）


def seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    L2 = vx * vx + vy * vy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / L2))
    dx, dy = px - (ax + t * vx), py - (ay + t * vy)
    return math.hypot(dx, dy)


def rounded_rect_sd(px, py, half, r):
    """圆角矩形有符号距离（中心在原点，边长为 2*half）"""
    qx = abs(px) - (half - r)
    qy = abs(py) - (half - r)
    ax, ay = max(qx, 0.0), max(qy, 0.0)
    return math.hypot(ax, ay) + min(max(qx, qy), 0.0) - r


def render(size, ss=2):
    """返回 RGBA 像素字节，ss 为超采样倍数"""
    n = size
    acc = [[0.0, 0.0, 0.0, 0.0] for _ in range(n * n)]
    inv = 1.0 / ss
    for sy in range(ss):
        for sx in range(ss):
            for y in range(n):
                fy = (y + (sy + 0.5) * inv) / n
                for x in range(n):
                    fx = (x + (sx + 0.5) * inv) / n
                    # 圆角方形遮罩
                    sd = rounded_rect_sd(fx - 0.5, fy - 0.5, 0.5, RADIUS)
                    cov = min(1.0, max(0.0, 0.5 - sd * n))
                    if cov <= 0:
                        continue
                    # 渐变底色
                    t = min(1.0, max(0.0, (fx + fy) * 0.5))
                    r = C1[0] + (C2[0] - C1[0]) * t
                    g = C1[1] + (C2[1] - C1[1]) * t
                    b = C1[2] + (C2[2] - C1[2]) * t
                    # 字标「F」
                    d = min(
                        seg_dist(fx, fy, *seg[0], *seg[1])
                        for stroke in GLYPH
                        for seg in zip(stroke, stroke[1:])
                    )
                    wcov = min(1.0, max(0.0, (W_HALF - d) * n + 0.5))
                    if wcov > 0:
                        r = r + (255 - r) * wcov
                        g = g + (255 - g) * wcov
                        b = b + (255 - b) * wcov
                    i = y * n + x
                    a = acc[i]
                    a[0] += r * cov; a[1] += g * cov; a[2] += b * cov; a[3] += cov
    tot = float(ss * ss)
    out = bytearray()
    for i in range(n * n):
        a = acc[i]
        cov = a[3] / tot
        if cov <= 0:
            out += b'\x00\x00\x00\x00'
        else:
            out += bytes((int(a[0] / a[3] + 0.5), int(a[1] / a[3] + 0.5), int(a[2] / a[3] + 0.5), int(cov * 255 + 0.5)))
    return bytes(out)


def png_encode(size, rgba):
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)                       # filter type 0 (None)
        raw += rgba[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
            + chunk(b'IEND', b''))


def ico_encode(images):
    """images: [(size, png_bytes)]，直接内嵌 PNG（Vista+ 支持）"""
    n = len(images)
    header = struct.pack('<HHH', 0, 1, n)
    offset = 6 + 16 * n
    entries, blobs = b'', b''
    for size, data in images:
        dim = 0 if size >= 256 else size
        entries += struct.pack('<BBBBHHII', dim, dim, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    return header + entries + blobs


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    images = []
    for s in sizes:
        png = png_encode(s, render(s, ss=2 if s <= 64 else 1))
        images.append((s, png))
        if s == 256:
            with open(os.path.join(OUT_DIR, 'icon.png'), 'wb') as f:
                f.write(png)
    with open(os.path.join(OUT_DIR, 'icon.ico'), 'wb') as f:
        f.write(ico_encode(images))
    print('icon.ico 已生成：%d 种尺寸 %s' % (len(images), sizes))
    print('icon.png 已生成：256x256')
    print('输出目录：' + os.path.normpath(OUT_DIR))


if __name__ == '__main__':
    main()
