use std::collections::{BTreeMap, HashSet};
use std::io::Read;

use serde_json::Value;

use crate::net;

type Fields = BTreeMap<String, String>;

pub fn media_frame(category: &str, subcategory: Option<&str>, title: &str) -> Option<String> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 200 {
        return None;
    }
    let source = match category {
        "планы" | "ожидание" | "пересмотр" | "брошено" => match subcategory.unwrap_or("").trim() {
            "аниме" => "аниме",
            "фильмы" | "сериалы" | "мультфильмы" | "мультсериалы" => "кино",
            _ => return None,
        },
        "аниме" => "аниме",
        "игры" => "игры",
        "кино" | "мульт" => "кино",
        _ => return None,
    };
    match source {
        "аниме" => shikimori_frame(title),
        "игры" => byrutgame_frame(title),
        "кино" => kinopoisk_frame(title),
        _ => None,
    }
}

fn shikimori_frame(title: &str) -> Option<String> {
    let ua = "FreedomArchive";
    let search_url = format!(
        "https://shikimori.io/api/animes?search={}&limit=1&censored=false",
        net::encode_query(title)
    );
    let list = net::get_json(&search_url, ua).ok()?;
    let id = list
        .as_array()
        .and_then(|items| items.first())
        .and_then(|item| {
            item.get("id")
                .and_then(|value| value.as_u64().or_else(|| value.as_i64().map(|n| n as u64)))
        })?;
    let shots = net::get_json(&format!("https://shikimori.io/api/animes/{id}/screenshots"), ua).ok()?;
    let items = shots.as_array().filter(|items| !items.is_empty())?;
    let index = random_index(items.len());
    let path = items
        .get(index)
        .and_then(|item| text_field(item, "original").or_else(|| text_field(item, "preview")))?;
    absolute_http_url(path, "https://shikimori.io")
}

fn byrutgame_frame(title: &str) -> Option<String> {
    let html = byrutgame_open(title).ok()?;
    let shots = byrutgame_screenshots(&html);
    if shots.is_empty() {
        return None;
    }
    let index = random_index(shots.len());
    shots.get(index).cloned()
}

fn kinopoisk_frame(title: &str) -> Option<String> {
    let agent = net::agent().ok()?;
    open_kinopoisk_session(&agent).ok()?;
    let (query, year) = split_title_year(title);
    let id = find_kinopoisk_id(&agent, &query, year).ok()?;
    let mut html =
        net::browser_agent_get(&agent, &format!("https://www.kinopoisk.ru/film/{id}/stills/")).ok()?;
    if html.contains("sso.kinopoisk.ru/install") {
        open_kinopoisk_session(&agent).ok()?;
        html = net::browser_agent_get(&agent, &format!("https://www.kinopoisk.ru/film/{id}/stills/")).ok()?;
    }
    let urls = kinopoisk_still_urls(&html);
    if urls.is_empty() {
        return None;
    }
    let index = random_index(urls.len());
    urls.get(index).cloned()
}

fn kinopoisk_still_urls(html: &str) -> Vec<String> {
    let mut urls = Vec::new();
    let mut seen = HashSet::new();
    let bytes = html.as_bytes();
    let marker = b"get-kinopoisk-image/";
    let mut offset = 0;
    while let Some(rel) = bytes[offset..]
        .windows(marker.len())
        .position(|window| window == marker)
    {
        let start = offset + rel;
        let tail = &html[start..];
        let end = tail
            .find(|ch: char| ch == '"' || ch == '\'' || ch == ')' || ch == ' ' || ch == '\\' || ch == '?')
            .unwrap_or(tail.len().min(120));
        let token = &tail[..end];
        offset = start + marker.len();
        // get-kinopoisk-image/{folder}/{uuid}/{size}
        let parts: Vec<&str> = token.split('/').collect();
        if parts.len() < 4 {
            continue;
        }
        let folder = parts[1];
        let uuid = parts[2];
        if folder.is_empty()
            || uuid.len() < 8
            || !folder.chars().all(|ch| ch.is_ascii_digit())
            || !uuid.chars().all(|ch| ch.is_ascii_hexdigit() || ch == '-')
        {
            continue;
        }
        let key = format!("{folder}/{uuid}");
        if !seen.insert(key) {
            continue;
        }
        urls.push(format!(
            "https://avatars.mds.yandex.net/get-kinopoisk-image/{folder}/{uuid}/orig"
        ));
    }
    urls
}

fn absolute_http_url(path: &str, host: &str) -> Option<String> {
    if path.starts_with("http://") || path.starts_with("https://") {
        Some(path.to_string())
    } else if path.starts_with('/') {
        Some(format!("{host}{path}"))
    } else {
        None
    }
}

fn random_index(len: usize) -> usize {
    if len <= 1 {
        return 0;
    }
    use std::time::{SystemTime, UNIX_EPOCH};
    let tick = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    (tick as usize).wrapping_mul(0x9E37_79B9) % len
}

pub fn lookup(category: &str, subcategory: Option<&str>, title: &str) -> Result<Fields, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("сначала укажите название".into());
    }
    if title.chars().count() > 200 {
        return Err("слишком длинное название для поиска".into());
    }
    let source = match category {
        "планы" | "ожидание" | "пересмотр" | "брошено" => match subcategory.unwrap_or("").trim() {
            "аниме" => "аниме",
            "фильмы" | "сериалы" | "мультфильмы" | "мультсериалы" => "кино",
            "книги" => "книги",
            _ => return Err("для этой подкатегории авто-поиск недоступен".into()),
        },
        other => other,
    };
    match source {
        "аниме" => shikimori("animes", title),
        "манга" => shikimori("mangas", title),
        "кино" | "мульт" => kinopoisk(title),
        "игры" => byrutgame(title),
        "книги" => litres(title),
        _ => Err("для этой категории авто-поиск недоступен".into()),
    }
}

fn put(fields: &mut Fields, key: &str, value: impl Into<String>) {
    let value = clean_value(value.into());
    if !value.is_empty() {
        fields.insert(key.to_string(), value);
    }
}

fn clean_value(value: String) -> String {
    let collapsed = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    collapsed.trim().to_string()
}

fn strip_html(raw: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in raw.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    html_entities(&out)
}

fn strip_bbcode(raw: &str) -> String {
    let mut out = String::new();
    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '[' {
            while let Some(next) = chars.next() {
                if next == ']' {
                    break;
                }
            }
            continue;
        }
        out.push(ch);
    }
    html_entities(&out)
}

fn html_entities(raw: &str) -> String {
    raw.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
}

fn join_names(items: &[String]) -> String {
    items
        .iter()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

fn label_key(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            'ё' | 'Ё' => 'е',
            other => other,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn dedupe_labels(items: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for item in items {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            continue;
        }
        let key = label_key(trimmed);
        if key.is_empty() || !seen.insert(key) {
            continue;
        }
        out.push(trimmed.to_string());
    }
    out
}

fn take_bytes<'a>(value: &'a str, max_bytes: usize) -> &'a str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

fn title_match_score(query: &str, candidate: &str) -> i32 {
    let query = label_key(query);
    let candidate = label_key(candidate);
    if query.is_empty() || candidate.is_empty() {
        return 0;
    }
    if query == candidate {
        return 1000;
    }
    if candidate.starts_with(&query) || query.starts_with(&candidate) {
        return 800 - (candidate.len() as i32 - query.len() as i32).abs();
    }
    if candidate.contains(&query) {
        return 500 - candidate.len() as i32;
    }
    if query.contains(&candidate) {
        return 400 - (query.len() as i32 - candidate.len() as i32).abs();
    }
    0
}

fn text_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(|item| item.as_str()).map(str::trim).filter(|item| !item.is_empty())
}

fn shikimori(kind: &str, title: &str) -> Result<Fields, String> {
    let ua = "FreedomArchive";
    let search_url = format!(
        "https://shikimori.io/api/{kind}?search={}&limit=1&censored=false",
        net::encode_query(title)
    );
    let list = net::get_json(&search_url, ua)?;
    let first = list
        .as_array()
        .and_then(|items| items.first())
        .ok_or_else(|| "на Shikimori ничего не найдено".to_string())?;
    let id = first
        .get("id")
        .and_then(|value| value.as_u64().or_else(|| value.as_i64().map(|n| n as u64)))
        .ok_or_else(|| "на Shikimori странный ответ".to_string())?;

    let detail_url = format!("https://shikimori.io/api/{kind}/{id}");
    let detail = net::get_json(&detail_url, ua)?;
    let mut fields = Fields::new();

    let russian = text_field(&detail, "russian").unwrap_or("");
    let name = text_field(&detail, "name").unwrap_or("");
    let title_l = title.to_lowercase();
    let alt = if !russian.is_empty()
        && title_l != russian.to_lowercase()
        && (name.is_empty() || title_l == name.to_lowercase())
    {
        russian
    } else if !name.is_empty() && title_l != name.to_lowercase() {
        name
    } else if !russian.is_empty() && title_l != russian.to_lowercase() {
        russian
    } else {
        text_field(&detail, "license_name_ru").unwrap_or("")
    };
    put(&mut fields, "altTitle", alt);

    if let Some(description) = text_field(&detail, "description") {
        put(&mut fields, "summary", strip_bbcode(description));
    }

    let mut genres = shikimori_genre_labels(kind, id, ua);
    if genres.is_empty() {
        genres = detail
            .get("genres")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| text_field(item, "russian").map(str::to_string))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
    }

    if let Some(aired) = text_field(&detail, "aired_on").or_else(|| text_field(&detail, "released_on")) {
        put(&mut fields, "released", format_date(aired));
    }

    if kind == "animes" {
        genres.extend(yummyanime_genre_labels(title));
        genres.extend(animego_genre_labels(title));
        if let Some(kind_value) = text_field(&detail, "kind") {
            put(&mut fields, "kind", map_anime_kind(kind_value));
        }
        if let Some(country) = anixart_country(title) {
            put(&mut fields, "country", country);
        } else {
            put(&mut fields, "country", "Япония");
        }
        if let Some(episodes) = detail.get("episodes").and_then(|value| value.as_u64()) {
            if episodes > 0 {
                put(&mut fields, "episodes", episodes.to_string());
            }
        }
        if let Some(duration) = detail.get("duration").and_then(|value| value.as_u64()) {
            if duration > 0 {
                put(&mut fields, "duration", duration.to_string());
            }
        }
        if let Some(rating) = text_field(&detail, "rating") {
            put(&mut fields, "ageRating", map_shiki_rating(rating));
        }
        let studios = detail
            .get("studios")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| text_field(item, "name").map(str::to_string))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        put(&mut fields, "studio", join_names(&studios));

        if let Some(origin) = shikimori_origin(id, ua) {
            put(&mut fields, "origin", origin);
        }

        if let Ok(roles) = net::get_json(&format!("https://shikimori.io/api/animes/{id}/roles"), ua) {
            let directors = roles
                .as_array()
                .into_iter()
                .flatten()
                .filter(|role| {
                    role.get("roles")
                        .and_then(|value| value.as_array())
                        .into_iter()
                        .flatten()
                        .any(|item| item.as_str() == Some("Director"))
                        || role
                            .get("roles_russian")
                            .and_then(|value| value.as_array())
                            .into_iter()
                            .flatten()
                            .any(|item| matches!(item.as_str(), Some("Режиссёр") | Some("Режиссер")))
                })
                .filter_map(|role| {
                    role.get("person")
                        .and_then(|person| text_field(person, "russian").or_else(|| text_field(person, "name")))
                        .map(str::to_string)
                })
                .collect::<Vec<_>>();
            put(&mut fields, "director", join_names(&directors));
        }
    } else {
        if let Some(kind_value) = text_field(&detail, "kind") {
            put(&mut fields, "kind", map_manga_kind(kind_value));
        }
        if let Some(chapters) = detail.get("chapters").and_then(|value| value.as_u64()) {
            if chapters > 0 {
                put(&mut fields, "chapters", chapters.to_string());
            }
        }
    }

    put(&mut fields, "genre", join_names(&dedupe_labels(genres)));

    if fields.is_empty() {
        Err("на Shikimori мало данных для подстановки".into())
    } else {
        Ok(fields)
    }
}

fn shikimori_graphql(body: &str, ua: &str) -> Option<Value> {
    let agent = net::agent().ok()?;
    let response = agent
        .post("https://shikimori.io/api/graphql")
        .set("User-Agent", ua)
        .set("Content-Type", "application/json")
        .set("Accept", "application/json")
        .send_string(body)
        .ok()?;
    let mut bytes = Vec::new();
    response.into_reader().take(256 * 1024).read_to_end(&mut bytes).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn shikimori_genre_labels(kind: &str, id: u64, ua: &str) -> Vec<String> {
    // REST omits many theme tags; GraphQL returns genre + theme (+ demographic under «Жанры»).
    let root = if kind == "animes" { "animes" } else { "mangas" };
    let body = format!(
        r#"{{"query":"query {{ {root}(ids: \"{id}\", limit: 1) {{ genres {{ russian kind }} }} }}"}}"#
    );
    let json = match shikimori_graphql(&body, ua) {
        Some(value) => value,
        None => return Vec::new(),
    };
    let path = format!("/data/{root}/0/genres");
    json.pointer(&path)
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .filter(|item| {
            matches!(
                text_field(item, "kind"),
                Some("genre") | Some("theme") | Some("demographic")
            )
        })
        .filter_map(|item| text_field(item, "russian").map(str::to_string))
        .collect()
}

fn anixart_country(title: &str) -> Option<String> {
    let agent = net::agent().ok()?;
    let body = format!(r#"{{"query":{}}}"#, serde_json::to_string(title).ok()?);
    let text = net::agent_post_json(
        &agent,
        "https://api-s.anixsekai.com/search/releases/0",
        "AnixartApp/9.0 (Android; mobile)",
        &body,
    )
    .ok()?;
    let json: Value = serde_json::from_str(&text).ok()?;
    let list = json
        .get("content")
        .or_else(|| json.get("releases"))
        .and_then(|value| value.as_array())?;
    let mut best: Option<(i32, String)> = None;
    for item in list {
        let ru = text_field(item, "title_ru").unwrap_or("");
        let original = text_field(item, "title_original").unwrap_or("");
        let score = title_match_score(title, ru).max(title_match_score(title, original));
        if score < 400 {
            continue;
        }
        let Some(country) = text_field(item, "country").map(str::to_string) else {
            continue;
        };
        if best
            .as_ref()
            .map(|(best_score, _)| score > *best_score)
            .unwrap_or(true)
        {
            best = Some((score, country));
        }
    }
    best.map(|(_, country)| country)
}

fn yummyanime_genre_labels(title: &str) -> Vec<String> {
    let agent = match net::agent() {
        Ok(agent) => agent,
        Err(_) => return Vec::new(),
    };
    let search_url = format!(
        "https://api.yani.tv/search?q={}&limit=8",
        net::encode_query(title)
    );
    let search = match net::agent_get_text(
        &agent,
        &search_url,
        net::browser_ua(),
        "application/json",
    ) {
        Ok(text) => text,
        Err(_) => return Vec::new(),
    };
    let json: Value = match serde_json::from_str(&search) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let list = json
        .get("response")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let mut best: Option<(i32, u64)> = None;
    for item in &list {
        let candidate = text_field(item, "title").unwrap_or("");
        let score = title_match_score(title, candidate);
        if score < 400 {
            continue;
        }
        let id = item
            .get("anime_id")
            .and_then(|value| value.as_u64().or_else(|| value.as_i64().map(|n| n as u64)));
        let Some(id) = id else { continue };
        if best
            .as_ref()
            .map(|(best_score, _)| score > *best_score)
            .unwrap_or(true)
        {
            best = Some((score, id));
        }
    }
    let Some((_, id)) = best else {
        return Vec::new();
    };
    let detail_url = format!("https://api.yani.tv/anime/{id}");
    let detail = match net::agent_get_text(
        &agent,
        &detail_url,
        net::browser_ua(),
        "application/json",
    ) {
        Ok(text) => text,
        Err(_) => return Vec::new(),
    };
    let json: Value = match serde_json::from_str(&detail) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let item = json.get("response").unwrap_or(&json);
    item.get("genres")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .filter_map(|genre| text_field(genre, "title").map(str::to_string))
        .collect()
}

fn animego_genre_labels(title: &str) -> Vec<String> {
    let agent = match net::agent() {
        Ok(agent) => agent,
        Err(_) => return Vec::new(),
    };
    let search_url = format!(
        "https://animego.me/search/anime?q={}",
        net::encode_query(title)
    );
    let html = match net::browser_agent_get(&agent, &search_url) {
        Ok(text) => text,
        Err(_) => return Vec::new(),
    };
    let mut best: Option<(i32, String)> = None;
    let mut offset = 0;
    while let Some(start) = html[offset..].find("href=\"/anime/") {
        let abs = offset + start + "href=\"".len();
        let Some(end) = html[abs..].find('"') else { break };
        let path = &html[abs..abs + end];
        offset = abs + end;
        if !path.starts_with("/anime/")
            || path.contains("/genre/")
            || path.contains("/status/")
            || path.contains("/season/")
            || path.contains("/random")
            || path.ends_with("/top-250")
        {
            continue;
        }
        let slug = path.trim_start_matches("/anime/");
        let has_id = slug
            .rsplit_once('-')
            .map(|(_, id)| !id.is_empty() && id.chars().all(|ch| ch.is_ascii_digit()))
            .unwrap_or(false);
        if !has_id {
            continue;
        }
        let tail = take_bytes(&html[abs + end..], 800);
        let name = if let Some(alt_at) = tail.find("alt=\"") {
            let from = alt_at + 5;
            tail[from..]
                .find('"')
                .map(|to| strip_html(&tail[from..from + to]))
        } else {
            None
        };
        let Some(name) = name.filter(|value| !value.is_empty()) else {
            continue;
        };
        let score = title_match_score(title, &name);
        if score < 400 {
            continue;
        }
        if best
            .as_ref()
            .map(|(best_score, _)| score > *best_score)
            .unwrap_or(true)
        {
            best = Some((score, path.to_string()));
        }
    }
    let Some((_, path)) = best else {
        return Vec::new();
    };
    let page = match net::browser_agent_get(&agent, &format!("https://animego.me{path}")) {
        Ok(text) => text,
        Err(_) => return Vec::new(),
    };
    animego_page_genres(&page)
}

fn animego_page_genres(html: &str) -> Vec<String> {
    let mut labels = Vec::new();
    for marker in ["entity-field__genres", "entity-field__themes", "entity-field__theme"] {
        let Some(start) = html.find(marker) else { continue };
        let slice = &html[start..];
        let end = slice.find("</div>")
            .and_then(|first| slice[first + 6..].find("</div>").map(|second| first + 6 + second))
            .unwrap_or(slice.len().min(2500));
        let block = &slice[..end];
        let mut offset = 0;
        while let Some(href_at) = block[offset..].find("href=\"") {
            let abs = offset + href_at + 6;
            let Some(href_end) = block[abs..].find('"') else { break };
            let href = &block[abs..abs + href_end];
            offset = abs + href_end;
            if !(href.contains("/genre/") || href.contains("/theme/") || href.contains("/tag/")) {
                continue;
            }
            let after = &block[offset..];
            let Some(text_start) = after.find('>') else { continue };
            let from = text_start + 1;
            let Some(text_end) = after[from..].find('<') else { continue };
            let label = strip_html(after[from..from + text_end].trim());
            if !label.is_empty() {
                labels.push(label);
            }
            offset += from + text_end;
        }
    }
    if !labels.is_empty() {
        return labels;
    }
    // Fallback: JSON-LD genre array on AnimeGO pages.
    if let Some(start) = html.find(r#""genre":["#) {
        let slice = &html[start + 9..];
        if let Some(end) = slice.find(']') {
            for part in slice[..end].split(',') {
                let cleaned = part.trim().trim_matches('"');
                if !cleaned.is_empty() {
                    labels.push(html_entities(cleaned));
                }
            }
        }
    }
    labels
}

fn map_shiki_rating(value: &str) -> String {
    // As shown on shikimori.io: «Рейтинг: PG-13», «R-17», «R+»
    match value {
        "g" => "G".into(),
        "pg" => "PG".into(),
        "pg_13" => "PG-13".into(),
        "r" => "R-17".into(),
        "r_plus" => "R+".into(),
        "rx" => "Rx".into(),
        "none" => String::new(),
        other => other.to_string(),
    }
}

fn shikimori_origin(id: u64, ua: &str) -> Option<String> {
    // REST /api/animes/:id does not expose origin; GraphQL does.
    let body = format!(
        r#"{{"query":"query {{ animes(ids: \"{id}\", limit: 1) {{ origin }} }}"}}"#
    );
    let json = shikimori_graphql(&body, ua)?;
    let origin = json
        .pointer("/data/animes/0/origin")
        .and_then(|value| value.as_str())?;
    let mapped = map_shiki_origin(origin);
    if mapped.is_empty() {
        None
    } else {
        Some(mapped)
    }
}

fn map_shiki_origin(value: &str) -> String {
    // Labels as on shikimori.io «Первоисточник: …»
    match value {
        "original" => "Оригинал".into(),
        "manga" => "Манга".into(),
        "web_manga" => "Веб-манга".into(),
        "four_koma_manga" => "Ёнкома".into(),
        "novel" => "Новелла".into(),
        "web_novel" => "Веб-новелла".into(),
        "visual_novel" => "Визуальная новелла".into(),
        "light_novel" => "Ранобэ".into(),
        "game" => "Игра".into(),
        "card_game" => "Карточная игра".into(),
        "music" => "Музыка".into(),
        "radio" => "Радио".into(),
        "book" => "Книга".into(),
        "picture_book" => "Книжка с картинками".into(),
        "mixed_media" => "Смешанные медиа".into(),
        "other" => "Другое".into(),
        "unknown" => String::new(),
        other => other.to_string(),
    }
}

fn format_date(value: &str) -> String {
    let value = value.trim();
    let parts: Vec<&str> = value.split('-').collect();
    match parts.as_slice() {
        [year, month, day]
            if year.len() == 4
                && month.len() == 2
                && day.len() == 2
                && year.chars().all(|ch| ch.is_ascii_digit())
                && month.chars().all(|ch| ch.is_ascii_digit())
                && day.chars().all(|ch| ch.is_ascii_digit()) =>
        {
            format!("{day}.{month}.{year}")
        }
        [year, month]
            if year.len() == 4
                && month.len() == 2
                && year.chars().all(|ch| ch.is_ascii_digit())
                && month.chars().all(|ch| ch.is_ascii_digit()) =>
        {
            format!("01.{month}.{year}")
        }
        _ => value.to_string(),
    }
}

fn map_anime_kind(value: &str) -> String {
    // Labels as on shikimori.io «Тип: …»
    match value {
        "tv" => "TV Сериал".into(),
        "movie" => "Фильм".into(),
        "ova" => "OVA".into(),
        "ona" => "ONA".into(),
        "special" => "Спешл".into(),
        "tv_special" => "TV Спешл".into(),
        "music" => "Клип".into(),
        "pv" => "Проморолик".into(),
        "cm" => "Реклама".into(),
        other => other.to_string(),
    }
}

fn map_manga_kind(value: &str) -> String {
    match value {
        "manga" => "Манга".into(),
        "manhwa" => "Манхва".into(),
        "manhua" => "Маньхуа".into(),
        "novel" => "Ранобэ".into(),
        "light_novel" => "Ранобэ".into(),
        "one_shot" => "Ваншот".into(),
        "doujin" => "Додзинси".into(),
        other => other.to_string(),
    }
}

fn kinopoisk(title: &str) -> Result<Fields, String> {
    let agent = net::agent()?;
    open_kinopoisk_session(&agent)?;
    let (query, year) = split_title_year(title);
    let id = find_kinopoisk_id(&agent, &query, year)?;
    let html = net::browser_agent_get(&agent, &format!("https://www.kinopoisk.ru/film/{id}/"))?;
    if html.contains("sso.kinopoisk.ru/install") {
        open_kinopoisk_session(&agent)?;
        let html = net::browser_agent_get(&agent, &format!("https://www.kinopoisk.ru/film/{id}/"))?;
        return parse_kinopoisk_film(&html, title);
    }
    parse_kinopoisk_film(&html, title)
}

fn open_kinopoisk_session(agent: &ureq::Agent) -> Result<(), String> {
    let home = net::browser_agent_get(agent, "https://www.kinopoisk.ru/")?;
    if let Some(host) = extract_json_string(&home, "host") {
        if host.contains("sso.kinopoisk.ru/install") {
            let _ = net::browser_agent_get(agent, &host)?;
        }
    }
    Ok(())
}

fn split_title_year(title: &str) -> (String, Option<u16>) {
    let trimmed = title.trim();
    let bytes = trimmed.as_bytes();
    if trimmed.ends_with(')') {
        if let Some(start) = trimmed.rfind(" (") {
            let inside = &trimmed[start + 2..trimmed.len() - 1];
            if inside.len() == 4 && inside.chars().all(|ch| ch.is_ascii_digit()) {
                if let Ok(year) = inside.parse::<u16>() {
                    return (trimmed[..start].trim().to_string(), Some(year));
                }
            }
        }
    }
    let _ = bytes;
    (trimmed.to_string(), None)
}

fn find_kinopoisk_id(agent: &ureq::Agent, query: &str, year: Option<u16>) -> Result<u64, String> {
    let url = format!(
        "https://www.kinopoisk.ru/index.php?kp_query={}",
        net::encode_query(query)
    );
    let mut html = net::browser_agent_get(agent, &url)?;
    if html.contains("sso.kinopoisk.ru/install") {
        open_kinopoisk_session(agent)?;
        html = net::browser_agent_get(agent, &url)?;
    }
    let ids = collect_film_ids(&html);
    if ids.is_empty() {
        return Err("на Кинопоиске ничего не найдено".into());
    }
    if let Some(year) = year {
        let year_token = format!("/{year}");
        // Prefer an id whose nearby snippet mentions the year.
        for id in &ids {
            let marker = format!("/film/{id}/");
            if let Some(idx) = html.find(&marker) {
                let from = idx.saturating_sub(120);
                let to = (idx + marker.len() + 180).min(html.len());
                let around = &html[from..to];
                if around.contains(&year.to_string()) || around.contains(&year_token) {
                    return Ok(*id);
                }
            }
        }
    }
    Ok(ids[0])
}

fn collect_film_ids(html: &str) -> Vec<u64> {
    let mut ids = Vec::new();
    let mut rest = html;
    while let Some(idx) = rest.find("/film/") {
        let after = &rest[idx + "/film/".len()..];
        let digits: String = after.chars().take_while(|ch| ch.is_ascii_digit()).collect();
        rest = &after[digits.len()..];
        if let Ok(id) = digits.parse::<u64>() {
            if id > 0 && !ids.contains(&id) {
                ids.push(id);
            }
        }
        if ids.len() >= 12 {
            break;
        }
    }
    ids
}

fn parse_kinopoisk_film(html: &str, title: &str) -> Result<Fields, String> {
    let mut fields = Fields::new();
    let movie = extract_movie_ld_json(html);

    if let Some(ref movie) = movie {
        let original = text_field(movie, "alternateName")
            .or_else(|| text_field(movie, "alternativeHeadline"))
            .unwrap_or("");
        let ru = text_field(movie, "name").unwrap_or("");
        let title_l = title.to_lowercase();
        if !original.is_empty() && !title_l.contains(&original.to_lowercase()) {
            put(&mut fields, "altTitle", original);
        } else if !ru.is_empty() && !title_l.contains(&ru.to_lowercase()) {
            put(&mut fields, "altTitle", ru);
        }

        if let Some(description) = text_field(movie, "description") {
            put(&mut fields, "summary", description);
        }

        let genres = match movie.get("genre") {
            Some(Value::Array(items)) => items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect::<Vec<_>>(),
            Some(Value::String(value)) => vec![value.clone()],
            _ => Vec::new(),
        };
        put(&mut fields, "genre", join_names(&genres));

        let countries = match movie.get("countryOfOrigin") {
            Some(Value::Array(items)) => items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect::<Vec<_>>(),
            Some(Value::String(value)) => vec![value.clone()],
            _ => Vec::new(),
        };
        put(&mut fields, "country", join_names(&countries));

        put(
            &mut fields,
            "director",
            join_names(&people_names(movie.get("director"))),
        );
        put(
            &mut fields,
            "producer",
            join_names(&people_names(movie.get("producer"))),
        );
        put(
            &mut fields,
            "actors",
            join_names(&people_names(movie.get("actor"))),
        );

        if let Some(runtime) = text_field(movie, "timeRequired") {
            if let Some(minutes) = parse_runtime_minutes(runtime) {
                put(&mut fields, "runtime", minutes.to_string());
            }
        }

        if let Some(rating) = text_field(movie, "contentRating") {
            let mpaa = rating
                .trim()
                .trim_start_matches("MPAA")
                .trim()
                .to_string();
            put(&mut fields, "mpaa", mpaa);
        }
    }

    if let Some(short) = kinopoisk_short_description(html) {
        put(&mut fields, "summary", short);
    }
    if let Some(value) = kinopoisk_row_text(html, "Сценарий") {
        put(&mut fields, "screenplay", value);
    }
    if let Some(value) = kinopoisk_row_text(html, "Бюджет") {
        put(&mut fields, "budget", value);
    }
    if let Some(value) = kinopoisk_row_text(html, "Сборы в мире") {
        put(&mut fields, "boxOffice", simplify_box_office(&value));
    }
    if let Some(value) = kinopoisk_row_text(html, "Возраст") {
        put(&mut fields, "ageRating", value);
    }
    if fields.get("mpaa").is_none() {
        if let Some(value) = kinopoisk_row_text(html, "Рейтинг MPAA") {
            put(&mut fields, "mpaa", value);
        }
    }
    if fields.get("runtime").is_none() {
        if let Some(value) = kinopoisk_row_text(html, "Время") {
            if let Some(minutes) = parse_runtime_minutes(&value) {
                put(&mut fields, "runtime", minutes.to_string());
            }
        }
    }
    if let Some(value) = kinopoisk_row_text(html, "Премьера в мире")
        .or_else(|| kinopoisk_row_text(html, "Премьера в России"))
    {
        put(&mut fields, "released", format_russian_date(&value));
    } else if let Some(year) = kinopoisk_row_text(html, "Год производства") {
        put(&mut fields, "released", format_date(&year));
    }
    if let Some(value) = kinopoisk_row_text(html, "Количество сезонов")
        .or_else(|| kinopoisk_row_text(html, "Количество серий"))
    {
        let digits: String = value.chars().filter(|ch| ch.is_ascii_digit()).collect();
        put(&mut fields, "episodes", digits);
    }
    if fields.get("director").is_none() {
        if let Some(value) = kinopoisk_row_text(html, "Режиссер")
            .or_else(|| kinopoisk_row_text(html, "Режиссёр"))
        {
            put(&mut fields, "director", value);
        }
    }
    if fields.get("producer").is_none() {
        if let Some(value) = kinopoisk_row_text(html, "Продюсер") {
            put(&mut fields, "producer", value);
        }
    }
    if fields.get("genre").is_none() {
        if let Some(value) = kinopoisk_row_text(html, "Жанр") {
            put(&mut fields, "genre", value);
        }
    }
    if fields.get("country").is_none() {
        if let Some(value) = kinopoisk_row_text(html, "Страна") {
            put(&mut fields, "country", value);
        }
    }

    if fields.is_empty() {
        Err("на Кинопоиске мало данных для подстановки".into())
    } else {
        Ok(fields)
    }
}

fn extract_movie_ld_json(html: &str) -> Option<Value> {
    let mut rest = html;
    while let Some(start) = rest.find(r#"<script type="application/ld+json">"#) {
        let after = &rest[start + r#"<script type="application/ld+json">"#.len()..];
        let end = after.find("</script>")?;
        let chunk = after[..end].trim();
        rest = &after[end..];
        if let Ok(value) = serde_json::from_str::<Value>(chunk) {
            if value.get("@type").and_then(|item| item.as_str()) == Some("Movie")
                || value.get("@type").and_then(|item| item.as_str()) == Some("TVSeries")
            {
                return Some(value);
            }
        }
    }
    None
}

fn people_names(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| text_field(item, "name").map(str::to_string))
            .collect(),
        Some(Value::Object(_)) => value
            .and_then(|item| text_field(item, "name"))
            .map(|name| vec![name.to_string()])
            .unwrap_or_default(),
        Some(Value::String(name)) => vec![name.clone()],
        _ => Vec::new(),
    }
}

fn kinopoisk_short_description(html: &str) -> Option<String> {
    let marker = r#"name="description" content=""#;
    let start = html.find(marker)?;
    let after = &html[start + marker.len()..];
    let end = after.find('"')?;
    let mut raw = html_entities(&after[..end]);
    raw = raw.trim_start_matches(['🎬', ' ']).to_string();
    if let Some(cut) = raw.find(". Смотрите онлайн") {
        raw.truncate(cut + 1);
    }
    if let Some(cut) = raw.find(" Смотрите онлайн") {
        raw.truncate(cut);
    }
    let cleaned = clean_value(raw);
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

fn kinopoisk_row_text(html: &str, label: &str) -> Option<String> {
    let marker = format!("{label}</div>");
    let start = html.find(&marker)?;
    let after = &html[start + marker.len()..];
    let value_start = after.find('>')? + 1;
    let chunk = &after[value_start..];
    let end = chunk
        .find("</div></div>")
        .or_else(|| chunk.find("</div></div></div>"))
        .unwrap_or(chunk.len().min(1200));
    let text = strip_html(&chunk[..end]);
    let text = text
        .trim()
        .trim_end_matches(',')
        .trim()
        .to_string();
    if text.is_empty() {
        None
    } else {
        Some(clean_value(text))
    }
}

fn simplify_box_office(value: &str) -> String {
    if let Some(total) = value.split('=').next_back() {
        clean_value(total.to_string())
    } else {
        clean_value(value.to_string())
    }
}

fn parse_runtime_minutes(value: &str) -> Option<u32> {
    let value = value.trim();
    if value.chars().all(|ch| ch.is_ascii_digit()) {
        return value.parse().ok().filter(|n| *n > 0);
    }
    let iso = value.strip_prefix('T').unwrap_or(value);
    if iso.contains('H') || iso.contains('M') {
        let mut hours = 0u32;
        let mut mins = 0u32;
        let mut num = String::new();
        for ch in iso.chars() {
            if ch.is_ascii_digit() {
                num.push(ch);
            } else if ch == 'H' {
                hours = num.parse().unwrap_or(0);
                num.clear();
            } else if ch == 'M' {
                mins = num.parse().unwrap_or(0);
                num.clear();
            }
        }
        let total = hours * 60 + mins;
        if total > 0 {
            return Some(total);
        }
    }
    let lower = value.to_lowercase();
    let mut hours = 0u32;
    let mut mins = 0u32;
    if let Some(idx) = lower.find('ч') {
        let head: String = lower[..idx]
            .chars()
            .rev()
            .take_while(|ch| ch.is_ascii_digit() || ch.is_whitespace())
            .collect::<String>()
            .chars()
            .rev()
            .filter(|ch| ch.is_ascii_digit())
            .collect();
        hours = head.parse().unwrap_or(0);
    }
    if let Some(idx) = lower.find("мин") {
        let head: String = lower[..idx]
            .chars()
            .rev()
            .take_while(|ch| ch.is_ascii_digit() || ch.is_whitespace())
            .collect::<String>()
            .chars()
            .rev()
            .filter(|ch| ch.is_ascii_digit())
            .collect();
        mins = head.parse().unwrap_or(0);
    }
    let total = hours * 60 + mins;
    if total > 0 {
        Some(total)
    } else {
        None
    }
}

fn format_russian_date(value: &str) -> String {
    let value = value.split(',').next().unwrap_or(value).trim();
    let parts: Vec<&str> = value.split_whitespace().collect();
    if parts.len() >= 3 {
        let day = parts[0];
        let month = russian_month(parts[1]);
        let year = parts[2].chars().take_while(|ch| ch.is_ascii_digit()).collect::<String>();
        if day.chars().all(|ch| ch.is_ascii_digit()) && month.is_some() && year.len() == 4 {
            return format!("{:0>2}.{}.{}", day, month.unwrap(), year);
        }
    }
    format_date(value)
}

fn russian_month(value: &str) -> Option<&'static str> {
    match value.trim_end_matches('.').to_lowercase().as_str() {
        "января" | "январь" | "янв" => Some("01"),
        "февраля" | "февраль" | "фев" => Some("02"),
        "марта" | "март" | "мар" => Some("03"),
        "апреля" | "апрель" | "апр" => Some("04"),
        "мая" | "май" => Some("05"),
        "июня" | "июнь" | "июн" => Some("06"),
        "июля" | "июль" | "июл" => Some("07"),
        "августа" | "август" | "авг" => Some("08"),
        "сентября" | "сентябрь" | "сент" => Some("09"),
        "октября" | "октябрь" | "окт" => Some("10"),
        "ноября" | "ноябрь" | "ноя" | "нояб" => Some("11"),
        "декабря" | "декабрь" | "дек" => Some("12"),
        _ => None,
    }
}

fn extract_json_string(source: &str, key: &str) -> Option<String> {
    let marker = format!("\"{key}\":\"");
    let rest = source.split(&marker).nth(1)?;
    let mut out = String::new();
    let mut chars = rest.chars();
    while let Some(ch) = chars.next() {
        match ch {
            '"' => break,
            '\\' => {
                if let Some(next) = chars.next() {
                    match next {
                        'u' => {
                            let hex: String = chars.by_ref().take(4).collect();
                            if let Ok(code) = u32::from_str_radix(&hex, 16) {
                                if let Some(decoded) = char::from_u32(code) {
                                    out.push(decoded);
                                }
                            }
                        }
                        'n' => out.push('\n'),
                        't' => out.push('\t'),
                        other => out.push(other),
                    }
                }
            }
            other => out.push(other),
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn byrutgame(title: &str) -> Result<Fields, String> {
    let html = byrutgame_open(title)?;
    let mut fields = Fields::new();

    if let Some(summary) = byrutgame_meta(&html, "og:description")
        .or_else(|| byrutgame_meta(&html, "description"))
    {
        put(&mut fields, "summary", summary);
    }

    let genres = byrutgame_genres(&html);
    put(&mut fields, "genre", join_names(&genres));

    if let Some(released) = byrutgame_detail(&html, "Дата выхода") {
        put(&mut fields, "released", format_russian_date(&released));
    }
    if let Some(developer) = byrutgame_detail(&html, "Разработчик") {
        put(&mut fields, "developer", developer);
    }
    if let Some(publisher) = byrutgame_detail(&html, "Издатель") {
        put(&mut fields, "publisher", publisher);
    }

    if fields.is_empty() {
        Err("на ByRutGame мало данных для подстановки".into())
    } else {
        Ok(fields)
    }
}

fn byrutgame_open(title: &str) -> Result<String, String> {
    let agent = net::agent()?;
    let search_url = format!(
        "https://byrutgame.org/index.php?story={}&do=search&subaction=search",
        net::encode_query(title)
    );
    let search = net::browser_agent_get(&agent, &search_url)?;
    let page_url = byrutgame_best_result(&search, title)
        .ok_or_else(|| "на ByRutGame ничего не найдено".to_string())?;
    net::browser_agent_get(&agent, &page_url)
}

fn byrutgame_best_result(html: &str, title: &str) -> Option<String> {
    let mut best: Option<(i32, String)> = None;
    let mut rest = html;
    while let Some(idx) = rest.find("class=\"search_res\"") {
        let before = &rest[..idx];
        let Some(href_at) = before.rfind("href=\"") else {
            rest = &rest[idx + 10..];
            continue;
        };
        let from = href_at + 6;
        let Some(to) = before[from..].find('"') else {
            rest = &rest[idx + 10..];
            continue;
        };
        let href = before[from..from + to].to_string();
        let after = &rest[idx..];
        let block_end = after.find("</a>").unwrap_or(after.len().min(2500));
        let name = extract_attr(&after[..block_end], "alt").unwrap_or_default();
        if !href.contains("byrutgame.org/") || !href.ends_with(".html") {
            rest = &rest[idx + 10..];
            continue;
        }
        let score = title_match_score(title, &name);
        if score >= 400
            && best
                .as_ref()
                .map(|(best_score, _)| score > *best_score)
                .unwrap_or(true)
        {
            best = Some((score, href));
        }
        rest = &rest[idx + 10..];
    }
    best.map(|(_, url)| url)
}

fn extract_attr(block: &str, name: &str) -> Option<String> {
    let marker = format!("{name}=\"");
    let start = block.find(&marker)? + marker.len();
    let end = block[start..].find('"')?;
    let value = strip_html(&block[start..start + end]);
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn byrutgame_detail(html: &str, label: &str) -> Option<String> {
    let markers = [
        format!("ul-details__label\">{label}:</span>"),
        format!("ul-details__label\">{label}</span>"),
    ];
    let idx = markers.iter().find_map(|marker| html.find(marker))?;
    let after = &html[idx..];
    let after_label = after.find("</span>")? + "</span>".len();
    let slice = &after[after_label..];
    let end = slice.find("</li>").unwrap_or(slice.len().min(500));
    let raw = strip_html(&slice[..end]);
    let cleaned = clean_value(raw);
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

fn byrutgame_genres(html: &str) -> Vec<String> {
    let Some(start) = html.find("ulgenre") else {
        return Vec::new();
    };
    let slice = &html[start..];
    let end = slice.find("</li>").unwrap_or(slice.len().min(1200));
    let block = &slice[..end];
    let mut genres = Vec::new();
    let mut rest = block;
    while let Some(idx) = rest.find("<a ") {
        let after = &rest[idx..];
        let Some(text_start) = after.find('>') else { break };
        let from = text_start + 1;
        let Some(text_end) = after[from..].find('<') else { break };
        let name = strip_html(after[from..from + text_end].trim());
        if !name.is_empty() {
            genres.push(name);
        }
        rest = &after[from + text_end..];
    }
    genres
}

fn byrutgame_meta(html: &str, name: &str) -> Option<String> {
    // property="og:description" content="..."  OR name="description" content="..."
    for attr in ["property", "name"] {
        let marker = format!("{attr}=\"{name}\"");
        if let Some(idx) = html.find(&marker) {
            let window = take_bytes(&html[idx..], 600);
            if let Some(content) = extract_attr(window, "content") {
                let cleaned = clean_value(content);
                if !cleaned.is_empty() {
                    return Some(cleaned);
                }
            }
        }
    }
    None
}

fn byrutgame_screenshots(html: &str) -> Vec<String> {
    let mut urls = Vec::new();
    let mut seen = HashSet::new();
    let mut rest = html;
    while let Some(idx) = rest.find("data-lightbox=\"game-screenshots\"") {
        let before = &rest[..idx];
        let Some(href_at) = before.rfind("href=") else {
            rest = &rest[idx + 10..];
            continue;
        };
        let quote = before.as_bytes().get(href_at + 5).copied().unwrap_or(b'"') as char;
        if quote != '"' && quote != '\'' {
            rest = &rest[idx + 10..];
            continue;
        }
        let from = href_at + 6;
        let Some(to) = before[from..].find(quote) else {
            rest = &rest[idx + 10..];
            continue;
        };
        let url = before[from..from + to].trim();
        if (url.starts_with("http://") || url.starts_with("https://"))
            && !url.contains("/thumbs/")
            && seen.insert(url.to_string())
        {
            urls.push(url.to_string());
        }
        rest = &rest[idx + 10..];
    }
    urls
}

fn litres(title: &str) -> Result<Fields, String> {
    let search_url = format!(
        "https://api.litres.ru/foundation/api/search?q={}&limit=5&types=text_book",
        net::encode_query(title)
    );
    let agent = net::agent()?;
    let response = agent
        .get(&search_url)
        .set("User-Agent", net::browser_ua())
        .set("Accept", "application/json")
        .set("App-Id", "115")
        .call()
        .map_err(|err| match err {
            ureq::Error::Status(code, _) => format!("LitRes ответил {code}"),
            _ => "не удалось связаться с LitRes".into(),
        })?;
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(4 * 1024 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|err| format!("не удалось прочитать ответ LitRes ({err})"))?;
    let search: Value = serde_json::from_slice(&bytes).map_err(|_| "LitRes вернул не JSON".to_string())?;
    let items = search
        .pointer("/payload/data")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "LitRes вернул странный ответ".to_string())?;
    let art_id = items
        .iter()
        .filter_map(|item| {
            item.get("instance")
                .and_then(|instance| instance.get("id"))
                .and_then(|value| value.as_u64())
        })
        .next()
        .ok_or_else(|| "на LitRes ничего не найдено".to_string())?;

    let detail_url = format!("https://api.litres.ru/foundation/api/arts/{art_id}");
    let detail_response = agent
        .get(&detail_url)
        .set("User-Agent", net::browser_ua())
        .set("Accept", "application/json")
        .set("App-Id", "115")
        .call()
        .map_err(|_| "не удалось открыть книгу на LitRes".to_string())?;
    let mut detail_bytes = Vec::new();
    detail_response
        .into_reader()
        .take(4 * 1024 * 1024)
        .read_to_end(&mut detail_bytes)
        .map_err(|err| format!("не удалось прочитать карточку LitRes ({err})"))?;
    let detail: Value =
        serde_json::from_slice(&detail_bytes).map_err(|_| "LitRes вернул не JSON".to_string())?;
    let art = detail
        .pointer("/payload/data")
        .ok_or_else(|| "LitRes не отдал карточку книги".to_string())?;

    let mut fields = Fields::new();
    if let Some(summary) = text_field(art, "html_annotation")
        .or_else(|| text_field(art, "annotation"))
        .or_else(|| text_field(art, "html_annotation_litres"))
    {
        put(&mut fields, "summary", strip_html(summary));
    }

    let authors = art
        .get("persons")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter(|person| text_field(person, "role") == Some("author"))
                .filter_map(|person| text_field(person, "full_name").map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    put(&mut fields, "author", join_names(&authors));

    if let Some(date) = text_field(art, "date_written_at").or_else(|| text_field(art, "publication_date"))
    {
        let year: String = date.chars().take(4).collect();
        if year.chars().all(|ch| ch.is_ascii_digit()) && year.len() == 4 {
            put(&mut fields, "year", year);
        }
    }

    if let Some(pages) = art
        .get("expected_pages_or_seconds")
        .and_then(|value| value.as_u64())
        .or_else(|| art.get("current_pages_or_seconds").and_then(|value| value.as_u64()))
    {
        if (10..50000).contains(&pages) {
            put(&mut fields, "pages", pages.to_string());
        }
    }

    if fields.is_empty() {
        Err("на LitRes мало данных для подстановки".into())
    } else {
        Ok(fields)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_helpers_remove_markup() {
        assert_eq!(strip_html("Hello <b>world</b>"), "Hello world");
        assert!(strip_bbcode("[character=1]Name[/character] text").contains("Name"));
    }

    #[test]
    fn encode_keeps_ascii_and_escapes_spaces() {
        assert_eq!(net::encode_query("a b"), "a%20b");
    }

    #[test]
    fn formats_shiki_date_rating_duration_style() {
        assert_eq!(format_date("2013-04-07"), "07.04.2013");
        assert_eq!(map_shiki_rating("pg_13"), "PG-13");
        assert_eq!(map_shiki_rating("r"), "R-17");
        assert_eq!(map_shiki_rating("r_plus"), "R+");
        assert_eq!(map_shiki_origin("manga"), "Манга");
        assert_eq!(map_shiki_origin("original"), "Оригинал");
        assert_eq!(map_anime_kind("tv"), "TV Сериал");
        assert_eq!(map_anime_kind("movie"), "Фильм");
        assert_eq!(map_anime_kind("ova"), "OVA");
    }

    #[test]
    fn dedupes_genre_labels_case_and_yo() {
        assert_eq!(
            dedupe_labels([
                "Экшен".into(),
                "экшен".into(),
                "Сёнен".into(),
                "Сенен".into(),
                "Сёнэн".into(),
            ]),
            vec![
                "Экшен".to_string(),
                "Сёнен".to_string(),
                "Сёнэн".to_string(),
            ]
        );
    }

    #[test]
    fn shikimori_fills_origin() {
        let anime = shikimori("animes", "Attack on Titan").expect("shikimori");
        assert_eq!(anime.get("origin").map(String::as_str), Some("Манга"), "{anime:?}");
        assert_eq!(anime.get("kind").map(String::as_str), Some("TV Сериал"), "{anime:?}");
        let genre = anime.get("genre").map(String::as_str).unwrap_or("");
        assert!(genre.contains("Экшен"), "{anime:?}");
        assert!(
            genre.contains("Жестокость") || genre.contains("Выживание") || genre.contains("Военное"),
            "expected shikimori themes in genre: {anime:?}"
        );
        assert_eq!(anime.get("country").map(String::as_str), Some("Япония"), "{anime:?}");
    }

    #[test]
    fn anixart_returns_country() {
        let country = anixart_country("Naruto").expect("anixart country");
        assert!(!country.trim().is_empty(), "{country}");
        assert!(
            country.to_lowercase().contains("япон") || country.eq_ignore_ascii_case("japan"),
            "{country}"
        );
    }

    #[test]
    fn anime_frame_from_shikimori_screenshots() {
        let frame = media_frame("аниме", None, "Naruto").expect("screenshot");
        assert!(frame.starts_with("https://shikimori.io/system/screenshots/"), "{frame}");
    }

    #[test]
    fn byrutgame_frame_from_screenshots() {
        let frame = media_frame("игры", None, "Hades").expect("byrutgame frame");
        assert!(frame.starts_with("https://"), "{frame}");
        assert!(frame.contains("byrutgame.org") || frame.contains("scr"), "{frame}");
    }

    #[test]
    fn kinopoisk_frame_from_stills() {
        let frame = media_frame("кино", None, "1+1 (2011)").expect("kinopoisk frame");
        assert!(
            frame.contains("get-kinopoisk-image") && frame.ends_with("/orig"),
            "{frame}"
        );
    }

    #[test]
    fn lookup_byrutgame_and_shikimori_and_litres() {
        let game = byrutgame("Hades").expect("byrutgame");
        assert!(game.contains_key("summary") || game.contains_key("developer"), "{game:?}");
        assert!(game.get("genre").is_some(), "{game:?}");
        let anime = shikimori("animes", "Naruto").expect("shikimori");
        assert!(anime.contains_key("summary") || anime.contains_key("genre"));
        let book = litres("Мастер и Маргарита").expect("litres");
        assert!(book.contains_key("author") || book.contains_key("summary"));
    }

    #[test]
    fn formats_byrutgame_short_month() {
        assert_eq!(format_russian_date("17 сент. 2020"), "17.09.2020");
    }

    #[test]
    fn lookup_kinopoisk_intouchables() {
        let film = kinopoisk("1+1 (2011)").expect("kinopoisk");
        assert_eq!(film.get("altTitle").map(String::as_str), Some("Intouchables"));
        assert_eq!(film.get("runtime").map(String::as_str), Some("112"));
        assert_eq!(film.get("ageRating").map(String::as_str), Some("18+"));
        assert!(film.get("director").is_some(), "{film:?}");
        assert!(film.get("actors").is_some(), "{film:?}");
        assert!(
            film.get("released").map(|value| value.contains('.')).unwrap_or(false),
            "{film:?}"
        );
    }

    #[test]
    fn parses_russian_runtime_and_date() {
        assert_eq!(parse_runtime_minutes("1 ч 52 мин"), Some(112));
        assert_eq!(parse_runtime_minutes("T1H52M00S"), Some(112));
        assert_eq!(format_russian_date("23 сентября 2011"), "23.09.2011");
        assert_eq!(split_title_year("1+1 (2011)"), ("1+1".into(), Some(2011)));
    }
}
