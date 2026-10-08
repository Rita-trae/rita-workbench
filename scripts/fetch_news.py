#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抓取各平台热搜并标准化为统一 JSON 格式。
输出目录：news/  （每个平台一个 json 文件）
统一格式：
{
  "platform": "baidu",
  "name": "百度",
  "emoji": "🅱️",
  "updated_at": "2025-01-01T12:00:00+08:00",
  "data": [
    {"title": "...", "link": "...", "hot_value": 12345},
    ...
  ]
}
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone, timedelta

CST = timezone(timedelta(hours=8))
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "news")
TIMEOUT = 15

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
}


def fetch(url, headers=None, retries=3):
    h = dict(HEADERS)
    if headers:
        h.update(headers)
    last_err = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8", errors="replace"))
        except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
            last_err = e
            if i < retries - 1:
                time.sleep(1.5 * (i + 1))
            continue
    raise last_err


def now_iso():
    return datetime.now(CST).isoformat(timespec="seconds")


def save(platform, name, emoji, data):
    os.makedirs(OUT_DIR, exist_ok=True)
    payload = {
        "platform": platform,
        "name": name,
        "emoji": emoji,
        "updated_at": now_iso(),
        "data": data,
    }
    path = os.path.join(OUT_DIR, f"{platform}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"[OK] {name} -> {len(data)} 条 -> {path}")
    return path


# ---------- 各平台抓取 ----------

def fetch_baidu():
    url = "https://top.baidu.com/api/board?platform=wise&tab=realtime"
    raw = fetch(url)
    cards = raw.get("data", {}).get("cards", [])
    items = []
    for card in cards:
        contents = card.get("content", [])
        for c in contents:
            inner = c.get("content", [])
            if isinstance(inner, list):
                for it in inner:
                    title = it.get("word") or it.get("query")
                    if not title:
                        continue
                    link = it.get("url") or it.get("rawUrl") or f"https://www.baidu.com/s?wd={urllib.parse.quote(title)}"
                    hot = it.get("hotScore") or it.get("hot") or it.get("index") or 0
                    items.append({"title": title, "link": link, "hot_value": hot})
            if items:
                break
        if items:
            break
    return save("baidu", "百度", "🅱️", items)


def fetch_toutiao():
    url = "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc"
    raw = fetch(url)
    data = raw.get("data", [])
    items = []
    for it in data:
        title = it.get("Title")
        if not title:
            continue
        link = it.get("Url") or f"https://www.toutiao.com/search/?keyword={urllib.parse.quote(title)}"
        hot = it.get("HotValue") or it.get("hot_value") or 0
        items.append({"title": title, "link": link, "hot_value": hot})
    return save("toutiao", "头条", "📰", items)


def fetch_bilibili():
    url = "https://app.bilibili.com/x/v2/search/trending/ranking?limit=30"
    raw = fetch(url)
    data = raw.get("data", {}).get("list", [])
    items = []
    for it in data:
        title = it.get("keyword") or it.get("show_name")
        if not title:
            continue
        link = f"https://search.bilibili.com/all?keyword={urllib.parse.quote(title)}"
        hot = it.get("hot_id") or it.get("position") or 0
        items.append({"title": title, "link": link, "hot_value": hot})
    return save("bilibili", "B站", "📺", items)


def fetch_thepaper():
    url = "https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar"
    raw = fetch(url)
    data = raw.get("data", {}).get("hotNews", [])
    items = []
    for it in data:
        title = it.get("name")
        if not title:
            continue
        cont_id = it.get("contId")
        link = f"https://www.thepaper.cn/newsDetail_forward_{cont_id}" if cont_id else \
               f"https://www.thepaper.cn/searchResult?word={urllib.parse.quote(title)}"
        hot = it.get("hotScore") or it.get("praiseNum") or 0
        items.append({"title": title, "link": link, "hot_value": hot})
    return save("thepaper", "澎湃", "📰", items)


def fetch_weibo():
    """微博热搜：尝试多个接口"""
    urls = [
        "https://weibo.com/ajax/side/hotSearch",
        "https://m.weibo.cn/api/container/getIndex?containerid=106003type%3D25%26t%3D3%26disable_hot%3D1%26filter_type%3Drealtimehot",
    ]
    for url in urls:
        try:
            raw = fetch(url, headers={"Referer": "https://weibo.com/"})
            data = raw.get("data", {}).get("realtime", [])
            items = []
            for it in data:
                title = it.get("word") or it.get("note")
                if not title:
                    continue
                link = it.get("scheme") or f"https://s.weibo.com/weibo?q=%23{urllib.parse.quote(title)}%23"
                hot = it.get("num") or it.get("raw_hot") or 0
                items.append({"title": title, "link": link, "hot_value": hot})
            if items:
                return save("weibo", "微博", "🦊", items)
        except Exception as e:
            print(f"[WARN] weibo {url[:50]}...: {e}")
    print("[SKIP] 微博热搜获取失败")
    return None


def fetch_zhihu():
    """知乎热榜"""
    url = "https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=30"
    try:
        raw = fetch(url, headers={"Referer": "https://www.zhihu.com/hot"})
        data = raw.get("data", [])
        items = []
        for it in data:
            target = it.get("target", {})
            title = target.get("title")
            if not title:
                continue
            qid = target.get("id")
            link = f"https://www.zhihu.com/question/{qid}" if qid else \
                   f"https://www.zhihu.com/search?q={urllib.parse.quote(title)}"
            hot = it.get("detail_text") or 0
            items.append({"title": title, "link": link, "hot_value": hot})
        if items:
            return save("zhihu", "知乎", "❓", items)
    except Exception as e:
        print(f"[WARN] zhihu: {e}")
    print("[SKIP] 知乎热榜获取失败")
    return None


def fetch_douyin():
    """抖音热搜"""
    url = "https://www.iesdouyin.com/aweme/v1/web/hot/search/list/"
    try:
        raw = fetch(url)
        data = raw.get("data", {}).get("word_list", [])
        items = []
        for it in data:
            title = it.get("word")
            if not title:
                continue
            link = f"https://www.douyin.com/search/{urllib.parse.quote(title)}"
            hot = it.get("hot_value") or 0
            items.append({"title": title, "link": link, "hot_value": hot})
        if items:
            return save("douyin", "抖音", "🎵", items)
    except Exception as e:
        print(f"[WARN] douyin: {e}")
    print("[SKIP] 抖音热搜获取失败")
    return None


def main():
    print(f"开始抓取热搜 ({now_iso()})")
    print("-" * 50)
    funcs = [fetch_baidu, fetch_toutiao, fetch_bilibili, fetch_thepaper,
             fetch_weibo, fetch_zhihu, fetch_douyin]
    ok = 0
    for fn in funcs:
        try:
            if fn():
                ok += 1
        except Exception as e:
            print(f"[ERR] {fn.__name__}: {e}")
        time.sleep(0.5)
    print("-" * 50)
    print(f"完成：成功 {ok}/{len(funcs)} 个平台")
    return 0 if ok > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
