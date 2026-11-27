
from argparse import ArgumentParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

APP = Path(__file__).resolve().parents[1] / "app"
OLLAMA_CHAT = "http://127.0.0.1:11434/api/chat"


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP), **kwargs)

    def json_response(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path != "/api/consultas":
            self.send_error(404)
            return
        if self.headers.get_content_type() != "application/json":
            self.send_error(415)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 12000:
                self.send_error(413)
                return
            messages = json.loads(self.rfile.read(length))["messages"]
            if [msg["role"] for msg in messages] != ["system", "user"]:
                raise ValueError("Roles inválidos")
            if not all(isinstance(msg["content"], str) for msg in messages):
                raise ValueError("Mensajes inválidos")
        except (ValueError, KeyError, UnicodeError, TypeError):
            self.json_response(400, {"error": "Petición de consulta inválida"})
            return

        payload = {
            "model": self.server.model,
            "messages": messages,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0, "num_predict": 450},
        }
        upstream = Request(
            OLLAMA_CHAT, data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        try:
            with urlopen(upstream, timeout=40) as res:
                result = json.loads(json.load(res)["message"]["content"])
            if not isinstance(result, dict):
                raise ValueError("Respuesta inválida")
            self.json_response(200, result)
        except (URLError, TimeoutError, ValueError, KeyError, TypeError):
            self.json_response(502, {"error": "El modelo local no devolvió una respuesta válida"})


def main():
    parser = ArgumentParser(description="Sirve BioPlant AI y conecta su consulta con un modelo local de Ollama.")
    parser.add_argument("--modelo", required=True, help="Nombre de un modelo local que ya figure en ollama list.")
    parser.add_argument("--puerto", default=8000, type=int)
    args = parser.parse_args()
    with ThreadingHTTPServer(("127.0.0.1", args.puerto), AppHandler) as server:
        server.model = args.modelo
        print(f"BioPlant AI: http://127.0.0.1:{server.server_port}/?llm=1", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()

