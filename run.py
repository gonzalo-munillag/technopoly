#!/usr/bin/env python3
"""Launch the Technopoly game server."""
import os

from server.app import app, socketio

if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    port = int(os.environ.get("PORT", "8083"))
    socketio.run(app, host="0.0.0.0", port=port, debug=debug)
