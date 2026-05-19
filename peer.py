"""LAN peer discovery via mDNS (Zeroconf)."""
import json
import socket
import threading
from urllib.request import Request, urlopen

from zeroconf import ServiceBrowser, ServiceInfo, Zeroconf, NonUniqueNameException

from identity import get_or_create_identity

SERVICE_TYPE = "_taskdone._http._tcp.local."
PEER_API_VERSION = 1


def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


def _extract_ip(info):
    if info.addresses:
        addr = info.addresses[0]
        if isinstance(addr, bytes):
            return socket.inet_ntoa(addr)
        return addr
    return None


class PeerRegistry:
    def __init__(self, own_instance_id, own_port):
        self._own_id = own_instance_id
        self._own_port = own_port
        self._zc = Zeroconf()
        self._browser = None
        self._service_info = None
        self._peers = {}
        self._lock = threading.Lock()

    @property
    def own_instance_id(self):
        return self._own_id

    def start(self):
        if self._service_info is not None:
            return
        identity = get_or_create_identity()
        self._service_info = ServiceInfo(
            SERVICE_TYPE,
            f"{identity['instance_id']}.{SERVICE_TYPE}",
            addresses=[socket.inet_aton(local_ip())],
            port=self._own_port,
            properties={
                b"instance_id": identity["instance_id"].encode(),
                b"display_name": identity["display_name"].encode(),
                b"version": str(PEER_API_VERSION).encode(),
            },
        )
        try:
            self._zc.register_service(self._service_info, ttl=60)
        except NonUniqueNameException:
            pass
        self._browser = ServiceBrowser(self._zc, SERVICE_TYPE, handlers=[self._on_change])

    def stop(self):
        if self._browser:
            self._browser.cancel()
        if self._service_info:
            self._zc.unregister_service(self._service_info)
        self._zc.close()

    def _on_change(self, zeroconf, service_type, name, state_change):
        if state_change.name == "Removed":
            self._del(name)
        else:
            info = zeroconf.get_service_info(service_type, name)
            if info:
                self._add(name, info)

    def _del(self, name):
        prefix = name.split(".")[0]
        with self._lock:
            self._peers.pop(prefix, None)

    def _add(self, name, info):
        prefix = name.split(".")[0]
        if prefix == self._own_id:
            return
        props = {}
        if info.properties:
            for k, v in info.properties.items():
                key = k.decode() if isinstance(k, bytes) else k
                val = v.decode() if isinstance(v, bytes) else v
                props[key] = val
        version = props.get("version", "1")
        if version != str(PEER_API_VERSION):
            return
        host = _extract_ip(info)
        if not host:
            return
        with self._lock:
            self._peers[prefix] = {
                "instance_id": props.get("instance_id", prefix),
                "display_name": props.get("display_name", "Unknown"),
                "host": host,
                "port": info.port,
            }

    def get_peers(self):
        with self._lock:
            return list(self._peers.values())

    def get_peer(self, instance_id):
        with self._lock:
            return self._peers.get(instance_id)

    def refresh_name(self):
        identity = get_or_create_identity()
        if self._service_info:
            self._service_info.properties[b"display_name"] = identity["display_name"].encode()
            self._zc.update_service(self._service_info)

    def has_peers(self):
        with self._lock:
            return len(self._peers) > 0


def send_status_update(host, port, task_id, status, from_instance):
    url = f"http://{host}:{port}/peer/status-update"
    data = json.dumps({
        "task_id": task_id,
        "status": status,
        "from_instance": from_instance,
    }).encode()
    req = Request(url, data=data, headers={"Content-Type": "application/json"})
    with urlopen(req, timeout=5) as resp:
        return json.loads(resp.read())