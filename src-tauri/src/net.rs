use std::io::Read;
use std::sync::Arc;
use std::time::Duration;

const BROWSER_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

pub fn agent() -> Result<ureq::Agent, String> {
    let tls = ureq::native_tls::TlsConnector::new()
        .map_err(|err| format!("не удалось настроить HTTPS ({err})"))?;
    Ok(ureq::AgentBuilder::new()
        .tls_connector(Arc::new(tls))
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(45))
        .redirects(8)
        .build())
}

pub fn agent_get_bytes(
    agent: &ureq::Agent,
    url: &str,
    user_agent: &str,
    accept: &str,
) -> Result<Vec<u8>, String> {
    let response = agent
        .get(url)
        .set("User-Agent", user_agent)
        .set("Accept", accept)
        .set("Accept-Language", "ru-RU,ru;q=0.9,en;q=0.8")
        .call()
        .map_err(map_ureq)?;
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|err| format!("не удалось прочитать ответ ({err})"))?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("ответ слишком большой".into());
    }
    Ok(bytes)
}

pub fn agent_get_text(
    agent: &ureq::Agent,
    url: &str,
    user_agent: &str,
    accept: &str,
) -> Result<String, String> {
    let bytes = agent_get_bytes(agent, url, user_agent, accept)?;
    String::from_utf8(bytes).map_err(|_| "ответ не в UTF-8".into())
}

pub fn get_text(url: &str, user_agent: &str, accept: &str) -> Result<String, String> {
    agent_get_text(&agent()?, url, user_agent, accept)
}

pub fn browser_agent_get(agent: &ureq::Agent, url: &str) -> Result<String, String> {
    agent_get_text(
        agent,
        url,
        BROWSER_UA,
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    )
}

pub fn get_json(url: &str, user_agent: &str) -> Result<serde_json::Value, String> {
    let text = get_text(url, user_agent, "application/json")?;
    serde_json::from_str(&text).map_err(|_| "сайт вернул не JSON".into())
}

pub fn browser_get_json(url: &str) -> Result<serde_json::Value, String> {
    get_json(url, BROWSER_UA)
}

pub fn browser_ua() -> &'static str {
    BROWSER_UA
}

fn map_ureq(err: ureq::Error) -> String {
    match err {
        ureq::Error::Status(code, _) => format!("сайт ответил {code}"),
        other => {
            let detail = other.to_string().to_ascii_lowercase();
            if detail.contains("dns failed") || detail.contains("resolve dns") {
                "не удалось найти сайт".into()
            } else if detail.contains("timed out") || detail.contains("timeout") {
                "сайт не ответил вовремя".into()
            } else if detail.contains("certificate") || detail.contains("ssl") || detail.contains("tls") {
                "не удалось установить защищённое соединение".into()
            } else {
                "не удалось связаться с сайтом".into()
            }
        }
    }
}

pub fn encode_query(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        match ch {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => out.push(ch),
            ' ' => out.push_str("%20"),
            _ => {
                for byte in ch.to_string().into_bytes() {
                    out.push_str(&format!("%{byte:02X}"));
                }
            }
        }
    }
    out
}
