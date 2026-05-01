"""
NTP 时间同步模块
"""
from __future__ import annotations

import socket
import struct
import time
import math
import logging
from typing import Tuple, Optional, List

logger = logging.getLogger(__name__)

NTP_SERVERS = [
    "ntp.aliyun.com",
    "ntp.tencent.com",
    "cn.ntp.org.cn",
    "ntp.ntsc.ac.cn",
    "time.pool.aliyun.com",
]

NTP_PORT = 123
NTP_PACKET_FORMAT = "!BBBb11I"
NTP_PACKET_SIZE = 48
NTP_VERSION = 4
NTP_MODE = 3
NTP_EPOCH = 2208988800


def get_ntp_time(server: str, timeout: float = 2.0) -> Optional[Tuple[float, float, float]]:
    """
    从 NTP 服务器获取时间
    
    参数:
        server: NTP 服务器地址
        timeout: 超时时间（秒）
    
    返回:
        (ntp_time, offset, rtt) - NTP 时间戳（秒），本地时钟与 NTP 的偏移（秒），往返延迟（秒）
        失败返回 None
    """
    client = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    client.settimeout(timeout)
    
    try:
        packet = bytearray(NTP_PACKET_SIZE)
        packet[0] = (NTP_VERSION << 3) | NTP_MODE
        
        transmit_time = time.time()
        transmit_ts = transmit_time + NTP_EPOCH
        transmit_frac, transmit_int = math.modf(transmit_ts)
        struct.pack_into("!II", packet, 40, int(transmit_int), int(transmit_frac * 2**32))
        
        start = time.perf_counter()
        client.sendto(packet, (server, NTP_PORT))
        response, _ = client.recvfrom(NTP_PACKET_SIZE)
        end = time.perf_counter()
        
        if len(response) < NTP_PACKET_SIZE:
            logger.warning(f"NTP 响应过短: {len(response)}")
            return None
        
        transit_int, transit_frac = struct.unpack_from("!II", response, 32)
        ntp_seconds = transit_int + (transit_frac / 2**32) - NTP_EPOCH
        
        rtt = end - start
        local_time = (start + end) / 2
        offset = ntp_seconds - local_time
        
        logger.debug(f"NTP 服务器 {server}: 偏移 {offset*1000:.2f}ms, 往返 {rtt*1000:.2f}ms")
        return (ntp_seconds, offset, rtt)
        
    except socket.timeout:
        logger.debug(f"NTP 服务器 {server} 超时")
        return None
    except Exception as e:
        logger.debug(f"NTP 服务器 {server} 错误: {e}")
        return None
    finally:
        client.close()


def sync_with_ntp() -> Optional[Tuple[float, float, str]]:
    """
    同步时间，尝试多个国内 NTP 服务器
    
    返回:
        (ntp_time, offset_ms, server) - 成功时返回时间、偏移（毫秒）和使用的服务器
        失败返回 None
    """
    for server in NTP_SERVERS:
        result = get_ntp_time(server)
        if result is not None:
            ntp_time, offset, _ = result
            return (ntp_time, offset * 1000, server)
    
    logger.error("所有 NTP 服务器同步失败")
    return None


def measure_ntp_latency(timeout: float = 1.0) -> Tuple[float, str]:
    """
    测量到 NTP 服务器的网络延迟
    
    参数:
        timeout: 超时时间（秒）
    
    返回:
        (latency_ms, server) - 延迟（毫秒）和使用的服务器
        失败返回 (0, "")
    """
    results: List[Tuple[float, str]] = []
    
    for server in NTP_SERVERS:
        result = get_ntp_time(server, timeout)
        if result is not None:
            _, _, rtt = result
            latency_ms = rtt * 1000
            results.append((latency_ms, server))
            logger.debug(f"NTP 延迟测量: {server} -> {latency_ms:.2f}ms")
    
    if not results:
        logger.warning("所有 NTP 服务器延迟测量失败")
        return (0, "")
    
    results.sort(key=lambda x: x[0])
    best_latency, best_server = results[0]
    
    logger.info(f"最佳 NTP 服务器: {best_server}, 延迟: {best_latency:.2f}ms")
    return (best_latency, best_server)
