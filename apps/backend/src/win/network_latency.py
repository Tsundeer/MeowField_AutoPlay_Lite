"""
网络延迟测量模块
使用 HTTP 请求测量网络延迟
"""
from __future__ import annotations

import urllib.request
import urllib.error
import time
import logging
from typing import Tuple

logger = logging.getLogger(__name__)

# 使用更可靠的互联网服务器进行延迟测量
HTTP_SERVERS = [
    ("https://www.baidu.com", "百度"),
    ("https://www.qq.com", "腾讯"),
    ("https://www.taobao.com", "淘宝"),
    ("https://www.bilibili.com", "B站"),
    ("https://www.163.com", "网易"),
]


def measure_network_latency(timeout: float = 2.0) -> Tuple[float, str]:
    """
    测量网络延迟，尝试多个服务器
    
    参数:
        timeout: 超时时间（秒）
    
    返回:
        (latency_ms, server_name) - 延迟（毫秒）和服务器名称
        失败返回 (-1, "测量失败")
    """
    logger.info("开始测量网络延迟...")
    
    # 记录所有失败的错误信息
    errors = []
    
    for url, name in HTTP_SERVERS:
        try:
            # 使用 GET 请求代替 HEAD，某些服务器可能不支持 HEAD
            start = time.perf_counter()
            req = urllib.request.Request(url, method='GET')
            req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
            req.add_header('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8')
            req.add_header('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8')
            req.add_header('Connection', 'close')  # 使用短连接避免保持连接的影响
            
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                # 读取少量数据确保连接建立
                _ = resp.read(1)
            
            end = time.perf_counter()
            latency_ms = (end - start) * 1000
            
            # 限制最大合理延迟值（超过 5 秒视为异常）
            if latency_ms > 5000:
                logger.warning(f"延迟异常过高: {name} -> {latency_ms:.2f}ms，可能网络不稳定")
                errors.append(f"{name}: 延迟过高 ({latency_ms:.0f}ms)")
                continue
            
            logger.info(f"延迟测量成功: {name} -> {latency_ms:.2f}ms")
            return (latency_ms, name)
            
        except urllib.error.HTTPError as e:
            # HTTP 错误（如 403, 404）但仍可计算延迟
            end = time.perf_counter()
            latency_ms = (end - start) * 1000
            if e.code in (403, 404, 405):  # 这些错误表示服务器响应了
                logger.info(f"延迟测量成功 (HTTP {e.code}): {name} -> {latency_ms:.2f}ms")
                return (latency_ms, name)
            logger.warning(f"延迟测量失败 (HTTP {e.code}): {name}")
            errors.append(f"{name}: HTTP {e.code}")
            continue
        except urllib.error.URLError as e:
            logger.warning(f"延迟测量失败 (URL错误): {name} -> {e}")
            errors.append(f"{name}: {str(e)[:50]}")
            continue
        except Exception as e:
            logger.warning(f"延迟测量失败: {name} -> {type(e).__name__}: {e}")
            errors.append(f"{name}: {type(e).__name__}")
            continue
    
    logger.error(f"所有 HTTP 服务器延迟测量失败: {'; '.join(errors)}")
    # 返回 -1 表示测量失败，而不是 0
    return (-1, "测量失败")
