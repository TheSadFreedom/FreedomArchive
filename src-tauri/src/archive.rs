use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;

struct Shelf {
    id: &'static str,
    subs: &'static [&'static str],
    rated: bool,
}

const SHELVES: &[Shelf] = &[
    Shelf {
        id: "аниме",
        subs: &["сериалы", "фильмы", "ova", "хентай"],
        rated: true,
    },
    Shelf {
        id: "кино",
        subs: &["фильмы", "сериалы"],
        rated: true,
    },
    Shelf {
        id: "мульт",
        subs: &["мультфильмы", "мультсериалы"],
        rated: true,
    },
    Shelf {
        id: "книги",
        subs: &[],
        rated: true,
    },
    Shelf {
        id: "манга",
        subs: &["манга", "хентай"],
        rated: true,
    },
    Shelf {
        id: "стендап",
        subs: &[],
        rated: true,
    },
    Shelf {
        id: "игры",
        subs: &[
            "пройдено",
            "брошено",
            "условно",
            "сыграно",
            "мобильные",
            "dlc",
            "моды",
            "ntfs",
        ],
        rated: false,
    },
];

const GAME_SHELF_MOVES: &[(&str, &str)] = &[
    ("пройдено", "пройдено"),
    ("брошено", "брошено"),
    ("условно", "условно"),
    ("моды", "моды"),
    ("android", "мобильные"),
    ("поиграл", "сыграно"),
    ("кооп", "сыграно"),
    ("старые", "сыграно"),
    ("не-идет", "сыграно"),
];

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp", "jfif"];
const CARDS_DIR: &str = "карточки";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub relative_path: String,
    pub title: String,
    pub category: String,
    pub subcategory: Option<String>,
    pub rating: u8,
    pub fields: BTreeMap<String, String>,
    pub image_path: String,
}

pub struct Archive {
    root: PathBuf,
}

impl Archive {
    pub fn open() -> Result<Self, String> {
        Self::at(archive_root()?)
    }

    pub fn at(root: PathBuf) -> Result<Self, String> {
        if root.file_name().and_then(|name| name.to_str()) == Some("Коллекции") {
            return Err("архив не может быть папкой Коллекции".into());
        }
        fs::create_dir_all(&root).map_err(|err| io("не удалось создать архив", err))?;
        let root = fs::canonicalize(&root).map_err(|err| io("не удалось открыть архив", err))?;
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn ensure_tree(&self) -> Result<(), String> {
        for shelf in SHELVES {
            for sub in shelf_leaves(shelf) {
                if shelf.rated {
                    for rating in 0..=5 {
                        let dir = self.leaf(shelf.id, sub, rating)?;
                        fs::create_dir_all(&dir).map_err(|err| io("не удалось создать папку", err))?;
                        self.ensure_inside(&dir)?;
                    }
                } else {
                    let dir = self.leaf(shelf.id, sub, 0)?;
                    fs::create_dir_all(&dir).map_err(|err| io("не удалось создать папку", err))?;
                    self.ensure_inside(&dir)?;
                }
            }
        }
        self.migrate_games()?;
        self.migrate_manga()?;
        self.migrate_categories()?;
        self.nest_cards()?;
        self.drop_added_marks()?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<Entry>, String> {
        let mut entries = Vec::new();
        for shelf in SHELVES {
            for sub in shelf_leaves(shelf) {
                if shelf.rated {
                    for rating in 0..=5 {
                        self.collect(shelf.id, sub, rating, &mut entries)?;
                    }
                } else {
                    self.collect(shelf.id, sub, 0, &mut entries)?;
                }
            }
        }
        entries.sort_by(|left, right| {
            left.title
                .to_lowercase()
                .cmp(&right.title.to_lowercase())
                .then_with(|| left.relative_path.cmp(&right.relative_path))
        });
        Ok(entries)
    }

    pub fn add(
        &self,
        source: &Path,
        category: &str,
        subcategory: Option<&str>,
        rating: u8,
        title: &str,
    ) -> Result<Entry, String> {
        let title = sanitize_title(title)?;
        let ext = image_extension(source)?;
        if !source.is_file() {
            return Err("исходный файл не найден".into());
        }
        let (image, meta) = self.destination(category, subcategory, rating, &title, &ext)?;
        if image.exists() || meta.exists() {
            return Err("такая запись уже есть".into());
        }
        fs::copy(source, &image).map_err(|err| io("не удалось скопировать обложку", err))?;
        self.read_entry(&image, category, subcategory, rating, &title)
    }

    pub fn update_card(
        &self,
        relative_path: &str,
        fields: BTreeMap<String, String>,
    ) -> Result<Entry, String> {
        let image = self.image_from_relative(relative_path)?;
        let fields = clean_fields(fields)?;
        store_card(&image, &fields)?;
        self.entry_at(&image)
    }

    pub fn move_entry(
        &self,
        relative_path: &str,
        category: &str,
        subcategory: Option<&str>,
        rating: u8,
        title: &str,
    ) -> Result<Entry, String> {
        let source_image = self.image_from_relative(relative_path)?;
        let title = sanitize_title(title)?;
        let ext = image_extension(&source_image)?;
        let (dest_image, dest_meta) =
            self.destination(category, subcategory, rating, &title, &ext)?;
        let source_meta = find_card(&source_image);

        if paths_equal(&source_image, &dest_image) {
            return self.entry_at(&source_image);
        }
        for path in [
            dest_image.clone(),
            json_path(&dest_image),
            dest_image.with_extension("json"),
        ] {
            if path.is_file() && !paths_equal(&path, &source_image) && !paths_equal(&path, &source_meta) {
                fs::remove_file(&path).map_err(|err| io("не удалось заменить запись", err))?;
            }
        }

        fs::rename(&source_image, &dest_image).map_err(|err| io("не удалось перенести обложку", err))?;
        if source_meta.is_file() {
            if let Some(parent) = dest_meta.parent() {
                if let Err(err) = fs::create_dir_all(parent) {
                    let _ = fs::rename(&dest_image, &source_image);
                    return Err(io("не удалось создать папку карточек", err));
                }
            }
            if let Err(err) = fs::rename(&source_meta, &dest_meta) {
                let _ = fs::rename(&dest_image, &source_image);
                return Err(io("не удалось перенести карточку", err));
            }
        }

        self.read_entry(&dest_image, category, subcategory, rating, &title)
    }

    pub fn delete_entry(&self, relative_path: &str) -> Result<(), String> {
        let image = self.image_from_relative(relative_path)?;
        let meta = json_path(&image);
        self.ensure_inside(&meta)?;
        fs::remove_file(&image).map_err(|err| io("не удалось удалить обложку", err))?;
        if meta.is_file() {
            fs::remove_file(&meta).map_err(|err| io("не удалось удалить карточку", err))?;
        }
        Ok(())
    }

    fn collect(
        &self,
        category: &str,
        subcategory: Option<&str>,
        rating: u8,
        entries: &mut Vec<Entry>,
    ) -> Result<(), String> {
        let dir = self.leaf(category, subcategory, rating)?;
        if !dir.is_dir() {
            return Ok(());
        }
        let read = fs::read_dir(&dir).map_err(|err| io("не удалось прочитать папку", err))?;
        for item in read {
            let item = item.map_err(|err| io("не удалось прочитать файл", err))?;
            let path = item.path();
            let meta = fs::symlink_metadata(&path).map_err(|err| io("не удалось прочитать файл", err))?;
            if meta.file_type().is_symlink() || !meta.is_file() || !is_image(&path) {
                continue;
            }
            let title = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("")
                .to_string();
            if title.is_empty() {
                continue;
            }
            entries.push(self.read_entry(&path, category, subcategory, rating, &title)?);
        }
        Ok(())
    }

    fn destination(
        &self,
        category: &str,
        subcategory: Option<&str>,
        rating: u8,
        title: &str,
        ext: &str,
    ) -> Result<(PathBuf, PathBuf), String> {
        check_placement(category, subcategory, rating)?;
        let dir = self.leaf(category, subcategory, rating)?;
        fs::create_dir_all(&dir).map_err(|err| io("не удалось создать папку", err))?;
        self.ensure_inside(&dir)?;
        let image = dir.join(format!("{title}.{ext}"));
        check_len(&image)?;
        self.ensure_inside(&image)?;
        let meta = json_path(&image);
        self.ensure_inside(&meta)?;
        Ok((image, meta))
    }

    fn leaf(&self, category: &str, subcategory: Option<&str>, rating: u8) -> Result<PathBuf, String> {
        check_placement(category, subcategory, rating)?;
        let mut path = self.root.join(category);
        if let Some(sub) = subcategory {
            path = path.join(sub);
        }
        if shelf_rated(category) {
            path = path.join(rating.to_string());
        }
        Ok(path)
    }

    fn migrate_games(&self) -> Result<(), String> {
        if self
            .root
            .components()
            .any(|component| component.as_os_str() == "Коллекции")
        {
            return Err("архив не может быть папкой Коллекции".into());
        }
        let games = self.root.join("игры");
        if !games.is_dir() {
            return Ok(());
        }
        self.ensure_inside(&games)?;

        for (from_sub, to_sub) in GAME_SHELF_MOVES {
            let from_sub = *from_sub;
            let to_sub = *to_sub;
            let from_dir = games.join(from_sub);
            if !from_dir.is_dir() {
                continue;
            }
            self.ensure_inside(&from_dir)?;
            let dest_dir = games.join(to_sub);
            fs::create_dir_all(&dest_dir).map_err(|err| io("не удалось создать папку", err))?;
            self.ensure_inside(&dest_dir)?;

            for rating in 0..=5 {
                let rating_dir = from_dir.join(rating.to_string());
                if !rating_dir.is_dir() {
                    continue;
                }
                self.ensure_inside(&rating_dir)?;
                self.flatten_rating_dir(&rating_dir, &dest_dir, from_sub, to_sub, rating)?;
                self.remove_dir_if_empty(&rating_dir)?;
            }
            if from_sub != to_sub {
                self.remove_dir_if_empty(&from_dir)?;
            }
        }
        Ok(())
    }

    fn migrate_manga(&self) -> Result<(), String> {
        let manga = self.root.join("манга");
        let from_anime = self.root.join("аниме").join("манга");
        for rating in 0..=5 {
            let dest = manga.join("манга").join(rating.to_string());
            let anime_rating = from_anime.join(rating.to_string());
            if anime_rating.is_dir() {
                fs::create_dir_all(&dest).map_err(|err| io("не удалось создать папку", err))?;
                self.ensure_inside(&dest)?;
                self.flatten_rating_dir(&anime_rating, &dest, "аниме/манга", "манга/манга", rating)?;
                self.remove_dir_if_empty(&anime_rating.join(CARDS_DIR))?;
                self.remove_dir_if_empty(&anime_rating)?;
            }
            let loose = manga.join(rating.to_string());
            if loose.is_dir() {
                fs::create_dir_all(&dest).map_err(|err| io("не удалось создать папку", err))?;
                self.ensure_inside(&dest)?;
                self.flatten_rating_dir(&loose, &dest, "манга", "манга/манга", rating)?;
                self.remove_dir_if_empty(&loose.join(CARDS_DIR))?;
                self.remove_dir_if_empty(&loose)?;
            }
        }
        self.remove_dir_if_empty(&from_anime)?;
        Ok(())
    }

    fn migrate_categories(&self) -> Result<(), String> {
        const MOVES: &[(&str, &str, &str)] = &[
            ("фильмы", "кино", "фильмы"),
            ("сериалы", "кино", "сериалы"),
            ("мультфильмы", "мульт", "мультфильмы"),
            ("мультсериалы", "мульт", "мультсериалы"),
        ];
        for (from, to, sub) in MOVES {
            let source = self.root.join(from);
            let dest = self.root.join(to).join(sub);
            self.move_rating_tree(&source, &dest, from, &format!("{to}/{sub}"))?;
            self.remove_dir_if_empty(&source)?;
        }
        let hentai = self.root.join("хентай");
        let hentai_manga = hentai.join("манга");
        self.move_rating_tree(
            &hentai_manga,
            &self.root.join("манга").join("хентай"),
            "хентай/манга",
            "манга/хентай",
        )?;
        self.remove_dir_if_empty(&hentai_manga)?;
        self.remove_dir_if_empty(&hentai)?;
        Ok(())
    }

    fn move_rating_tree(
        &self,
        from: &Path,
        dest_parent: &Path,
        from_label: &str,
        to_label: &str,
    ) -> Result<(), String> {
        if !from.is_dir() {
            return Ok(());
        }
        self.ensure_inside(from)?;
        for rating in 0..=5 {
            let rating_dir = from.join(rating.to_string());
            if !rating_dir.is_dir() {
                continue;
            }
            let dest = dest_parent.join(rating.to_string());
            fs::create_dir_all(&dest).map_err(|err| io("не удалось создать папку", err))?;
            self.ensure_inside(&dest)?;
            self.flatten_rating_dir(&rating_dir, &dest, from_label, to_label, rating)?;
            self.remove_dir_if_empty(&rating_dir.join(CARDS_DIR))?;
            self.remove_dir_if_empty(&rating_dir)?;
        }
        Ok(())
    }

    fn flatten_rating_dir(
        &self,
        rating_dir: &Path,
        dest_dir: &Path,
        from_sub: &str,
        to_sub: &str,
        rating: u8,
    ) -> Result<(), String> {
        let mut files = Vec::new();
        let read = fs::read_dir(rating_dir).map_err(|err| io("не удалось прочитать папку", err))?;
        for item in read {
            let item = item.map_err(|err| io("не удалось прочитать файл", err))?;
            files.push(item.path());
        }
        files.sort();
        for path in files {
            let meta = match fs::symlink_metadata(&path) {
                Ok(meta) => meta,
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
                Err(err) => return Err(io("не удалось прочитать файл", err)),
            };
            if meta.file_type().is_symlink() || !meta.is_file() || !is_image(&path) {
                continue;
            }
            self.ensure_inside(&path)?;
            let stem = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("")
                .to_string();
            if stem.is_empty() {
                continue;
            }
            let ext = image_extension(&path)?;
            let (dest_stem, renamed) = free_stem(dest_dir, &stem, &ext)?;
            let dest_image = dest_dir.join(format!("{dest_stem}.{ext}"));
            let dest_meta = json_path(&dest_image);
            check_len(&dest_image)?;
            self.ensure_inside(&dest_image)?;
            self.ensure_inside(&dest_meta)?;
            if renamed {
                eprintln!(
                    "название «{stem}» уже занято, файл оставлен как «{dest_stem}» ({from_sub}/{rating} → {to_sub})"
                );
            }
            let source_meta = find_card(&path);
            fs::rename(&path, &dest_image).map_err(|err| io("не удалось перенести обложку", err))?;
            if source_meta.is_file() {
                if let Some(parent) = dest_meta.parent() {
                    if let Err(err) = fs::create_dir_all(parent) {
                        let _ = fs::rename(&dest_image, &path);
                        return Err(io("не удалось создать папку карточек", err));
                    }
                }
                if let Err(err) = fs::rename(&source_meta, &dest_meta) {
                    let _ = fs::rename(&dest_image, &path);
                    return Err(io("не удалось перенести карточку", err));
                }
            }
        }
        Ok(())
    }

    fn remove_dir_if_empty(&self, path: &Path) -> Result<(), String> {
        if !path.is_dir() {
            return Ok(());
        }
        self.ensure_inside(path)?;
        match fs::remove_dir(path) {
            Ok(()) => Ok(()),
            Err(err) if dir_not_empty(&err) => Ok(()),
            Err(err) => Err(io("не удалось убрать пустую папку", err)),
        }
    }

    fn image_from_relative(&self, relative_path: &str) -> Result<PathBuf, String> {
        let image = self.join_relative(relative_path)?;
        if !image.is_file() {
            return Err("файл не найден".into());
        }
        if !is_image(&image) {
            return Err("это не изображение".into());
        }
        self.ensure_inside(&image)?;
        Ok(image)
    }

    fn join_relative(&self, relative_path: &str) -> Result<PathBuf, String> {
        if relative_path.trim().is_empty() {
            return Err("пустой путь".into());
        }
        let mut path = self.root.clone();
        for part in relative_path.split(['/', '\\']) {
            if part.is_empty() || part == "." || part == ".." {
                return Err("путь вне архива".into());
            }
            if part.contains(':') {
                return Err("путь вне архива".into());
            }
            path = path.join(part);
        }
        Ok(path)
    }

    fn entry_at(&self, image: &Path) -> Result<Entry, String> {
        let relative = self.relative_of(image)?;
        let mut parts = relative.split('/').collect::<Vec<_>>();
        let file_name = parts.pop().ok_or_else(|| "пустой путь".to_string())?;
        if parts.is_empty() {
            return Err("непонятный путь записи".into());
        }
        let category = parts[0].to_string();
        let (subcategory, rating) = if shelf_rated(&category) {
            let rating_text = parts.pop().ok_or_else(|| "в пути нет оценки".to_string())?;
            let rating: u8 = rating_text
                .parse()
                .map_err(|_| "в пути нет оценки".to_string())?;
            if rating > 5 {
                return Err("в пути нет оценки".into());
            }
            let subcategory = match parts.as_slice() {
                [cat] if *cat == category.as_str() => None,
                [cat, sub] if *cat == category.as_str() => Some((*sub).to_string()),
                _ => return Err("непонятный путь записи".into()),
            };
            (subcategory, rating)
        } else {
            let subcategory = match parts.as_slice() {
                [cat] if *cat == category.as_str() => None,
                [cat, sub] if *cat == category.as_str() => Some((*sub).to_string()),
                _ => return Err("непонятный путь записи".into()),
            };
            (subcategory, 0)
        };
        let title = Path::new(file_name)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("")
            .to_string();
        self.read_entry(
            image,
            &category,
            subcategory.as_deref(),
            rating,
            &title,
        )
    }

    fn read_entry(
        &self,
        image: &Path,
        category: &str,
        subcategory: Option<&str>,
        rating: u8,
        title: &str,
    ) -> Result<Entry, String> {
        let relative = self.relative_of(image)?;
        let image_path = path_to_string(image)?;
        let fields = read_card(&find_card(image));
        let rating = if shelf_rated(category) { rating } else { 0 };
        Ok(Entry {
            relative_path: relative,
            title: title.to_string(),
            category: category.to_string(),
            subcategory: subcategory.map(str::to_string),
            rating,
            fields,
            image_path,
        })
    }

    fn relative_of(&self, path: &Path) -> Result<String, String> {
        let relative = path.strip_prefix(&self.root).map_err(|_| "путь вне архива".to_string())?;
        let text = relative
            .components()
            .map(|component| component.as_os_str().to_str().unwrap_or(""))
            .collect::<Vec<_>>()
            .join("/");
        if text.is_empty() || text.split('/').any(|part| part.is_empty()) {
            return Err("путь вне архива".into());
        }
        Ok(text)
    }

    fn ensure_inside(&self, path: &Path) -> Result<(), String> {
        let root = fs::canonicalize(&self.root).map_err(|err| io("не удалось открыть архив", err))?;
        let target = anchor_path(&root, path)?;
        if target == root || target.starts_with(&root) {
            Ok(())
        } else {
            Err("путь вне архива".into())
        }
    }

    fn nest_cards(&self) -> Result<(), String> {
        let mut stack = vec![self.root.clone()];
        while let Some(dir) = stack.pop() {
            let name = dir.file_name().and_then(|part| part.to_str());
            if name == Some(CARDS_DIR) || name == Some("Коллекции") {
                continue;
            }
            self.ensure_inside(&dir)?;
            let read = match fs::read_dir(&dir) {
                Ok(read) => read,
                Err(_) => continue,
            };
            let mut jsons = Vec::new();
            for item in read {
                let item = item.map_err(|err| io("не удалось прочитать папку", err))?;
                let path = item.path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.extension().and_then(|ext| ext.to_str()) == Some("json") {
                    jsons.push(path);
                }
            }
            for path in jsons {
                self.ensure_inside(&path)?;
                let file_name = path
                    .file_name()
                    .ok_or_else(|| "путь вне архива".to_string())?;
                let cards = dir.join(CARDS_DIR);
                fs::create_dir_all(&cards).map_err(|err| io("не удалось создать папку карточек", err))?;
                self.ensure_inside(&cards)?;
                let mut dest = cards.join(file_name);
                self.ensure_inside(&dest)?;
                if dest.exists() {
                    if files_equal(&path, &dest) {
                        fs::remove_file(&path).map_err(|err| io("не удалось убрать карточку", err))?;
                        continue;
                    }
                    let stem = Path::new(file_name)
                        .file_stem()
                        .and_then(|stem| stem.to_str())
                        .unwrap_or("карточка");
                    dest = cards.join(format!("{stem} (2).json"));
                    self.ensure_inside(&dest)?;
                    if dest.exists() {
                        continue;
                    }
                }
                fs::rename(&path, &dest).map_err(|err| io("не удалось перенести карточку", err))?;
            }
        }
        Ok(())
    }

    fn drop_added_marks(&self) -> Result<(), String> {
        let mut stack = vec![self.root.clone()];
        while let Some(dir) = stack.pop() {
            let read = match fs::read_dir(&dir) {
                Ok(read) => read,
                Err(_) => continue,
            };
            for item in read {
                let item = item.map_err(|err| io("не удалось прочитать папку", err))?;
                let path = item.path();
                if path.is_dir() {
                    self.ensure_inside(&path)?;
                    stack.push(path);
                    continue;
                }
                if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                    continue;
                }
                self.ensure_inside(&path)?;
                forget_added_mark(&path)?;
            }
        }
        Ok(())
    }
}

fn dir_not_empty(err: &std::io::Error) -> bool {
    err.kind() == std::io::ErrorKind::DirectoryNotEmpty || err.raw_os_error() == Some(145)
}

fn shelf_leaves(shelf: &Shelf) -> Vec<Option<&str>> {
    if shelf.subs.is_empty() {
        vec![None]
    } else {
        shelf.subs.iter().copied().map(Some).collect()
    }
}

fn shelf_rated(category: &str) -> bool {
    SHELVES
        .iter()
        .find(|shelf| shelf.id == category)
        .map(|shelf| shelf.rated)
        .unwrap_or(true)
}

fn free_stem(dir: &Path, stem: &str, ext: &str) -> Result<(String, bool), String> {
    if !stem_taken(dir, stem, ext) {
        return Ok((stem.to_string(), false));
    }
    for index in 2..1000 {
        let candidate = format!("{stem} ({index})");
        if !stem_taken(dir, &candidate, ext) {
            return Ok((candidate, true));
        }
    }
    Err("слишком много совпадений названия".into())
}

fn stem_taken(dir: &Path, stem: &str, ext: &str) -> bool {
    dir.join(format!("{stem}.{ext}")).exists()
        || dir.join(CARDS_DIR).join(format!("{stem}.json")).exists()
        || dir.join(format!("{stem}.json")).exists()
}

fn check_placement(category: &str, subcategory: Option<&str>, rating: u8) -> Result<(), String> {
    if rating > 5 {
        return Err("оценка от 0 до 5".into());
    }
    let shelf = SHELVES
        .iter()
        .find(|shelf| shelf.id == category)
        .ok_or_else(|| "неизвестная категория".to_string())?;
    match (shelf.subs.is_empty(), subcategory) {
        (true, None) => Ok(()),
        (true, Some(_)) => Err("у этой категории нет подкатегории".into()),
        (false, None) => Err("нужна подкатегория".into()),
        (false, Some(sub)) if shelf.subs.contains(&sub) => Ok(()),
        (false, Some(_)) => Err("неизвестная подкатегория".into()),
    }
}

pub fn sanitize_title(raw: &str) -> Result<String, String> {
    let mut cleaned = String::new();
    for ch in raw.chars() {
        if matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || ch.is_control() {
            cleaned.push(' ');
        } else {
            cleaned.push(ch);
        }
    }
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let title = collapsed
        .trim_matches(|ch: char| ch == '.' || ch.is_whitespace())
        .to_string();
    if title.is_empty() {
        return Err("пустое название".into());
    }
    if title.chars().count() > 200 {
        return Err("слишком длинное название".into());
    }
    if is_reserved(&title) {
        return Err("недопустимое имя файла".into());
    }
    Ok(title)
}

fn is_reserved(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name);
    let upper = stem.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((upper.starts_with("COM") || upper.starts_with("LPT"))
            && upper.len() == 4
            && upper.as_bytes()[3].is_ascii_digit())
}

fn image_extension(path: &Path) -> Result<String, String> {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        Ok(ext)
    } else {
        Err("нужна картинка jpg, png, webp, gif или bmp".into())
    }
}

fn is_image(path: &Path) -> bool {
    image_extension(path).is_ok()
}

pub fn fetch_cover(url: &str) -> Result<PathBuf, String> {
    let url = url
        .trim()
        .trim_matches(|ch| matches!(ch, '"' | '\'' | '«' | '»' | '“' | '”'))
        .trim();
    if url.len() > 2000 || url.chars().any(|ch| ch.is_control() || ch.is_whitespace()) {
        return Err("непонятная ссылка".into());
    }
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err("нужна ссылка http или https".into());
    }

    // native-tls is never the default in ureq — it must be set on the agent,
    // otherwise every https:// request fails with "no TLS backend".
    let tls = ureq::native_tls::TlsConnector::new()
        .map_err(|err| format!("не удалось настроить HTTPS ({err})"))?;
    let agent = ureq::AgentBuilder::new()
        .tls_connector(Arc::new(tls))
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(45))
        .redirects(8)
        .build();
    let response = agent
        .get(url)
        .set(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        )
        .set(
            "Accept",
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        )
        .call()
        .map_err(|err| match err {
            ureq::Error::Status(code, _) => format!("ссылка ответила {code}"),
            other => download_err(&other.to_string()),
        })?;

    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(12 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|err| io("не удалось скачать изображение", err))?;
    if bytes.len() > 12 * 1024 * 1024 {
        return Err("изображение слишком большое".into());
    }
    let ext = image_kind(&bytes).ok_or_else(|| "по ссылке не картинка".to_string())?;
    let path = std::env::temp_dir().join(format!("freedom-cover-{}-{}.{ext}", std::process::id(), now_millis()));
    fs::write(&path, &bytes).map_err(|err| io("не удалось сохранить изображение", err))?;
    Ok(path)
}

fn download_err(detail: &str) -> String {
    let lower = detail.to_ascii_lowercase();
    if lower.contains("dns failed") || lower.contains("resolve dns") {
        "не удалось найти сайт по ссылке".into()
    } else if lower.contains("timed out") || lower.contains("timeout") {
        "сайт не ответил вовремя".into()
    } else if lower.contains("certificate") || lower.contains("ssl") || lower.contains("tls") {
        "не удалось установить защищённое соединение".into()
    } else {
        "не удалось скачать изображение".into()
    }
}

fn image_kind(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("jpg");
    }
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Some("png");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("gif");
    }
    if bytes.starts_with(b"BM") {
        return Some("bmp");
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    None
}

fn json_path(image: &Path) -> PathBuf {
    let mut file_name = image
        .file_stem()
        .map(|stem| stem.to_os_string())
        .unwrap_or_default();
    file_name.push(".json");
    image
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(CARDS_DIR)
        .join(file_name)
}

fn truncated_json_path(image: &Path) -> Option<PathBuf> {
    let stem = image.file_stem()?;
    if !stem.to_string_lossy().contains('.') {
        return None;
    }
    let mut path = image
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(CARDS_DIR);
    path.push(stem);
    path.set_extension("json");
    let correct = json_path(image);
    if path == correct { None } else { Some(path) }
}

fn sibling_owns_card(image: &Path, card: &Path) -> bool {
    let Some(parent) = image.parent() else {
        return false;
    };
    let Some(card_stem) = card.file_stem() else {
        return false;
    };
    let Ok(read) = fs::read_dir(parent) else {
        return false;
    };
    for item in read.flatten() {
        let path = item.path();
        if path == image || !is_image(&path) {
            continue;
        }
        if path.file_stem() == Some(card_stem) {
            return true;
        }
    }
    false
}

fn find_card(image: &Path) -> PathBuf {
    let nested = json_path(image);
    if nested.is_file() {
        return nested;
    }
    let legacy = image.with_extension("json");
    if legacy.is_file() {
        return legacy;
    }
    if let Some(truncated) = truncated_json_path(image) {
        if truncated.is_file() && !sibling_owns_card(image, &truncated) {
            if let Some(parent) = nested.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if fs::rename(&truncated, &nested).is_ok() {
                return nested;
            }
            return truncated;
        }
    }
    nested
}

fn store_card(image: &Path, fields: &BTreeMap<String, String>) -> Result<(), String> {
    let nested = json_path(image);
    let legacy = image.with_extension("json");
    write_card(&nested, fields)?;
    if legacy != nested && legacy.is_file() {
        fs::remove_file(&legacy).map_err(|err| io("не удалось убрать карточку", err))?;
    }
    Ok(())
}

fn anchor_path(root: &Path, path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return fs::canonicalize(path).map_err(|err| io("не удалось проверить путь", err));
    }
    let mut missing = Vec::new();
    let mut current = path.to_path_buf();
    loop {
        let Some(parent) = current.parent() else {
            return Err("путь вне архива".into());
        };
        if parent.as_os_str().is_empty() {
            return Err("путь вне архива".into());
        }
        let Some(name) = current.file_name() else {
            return Err("путь вне архива".into());
        };
        missing.push(name.to_os_string());
        if parent.exists() {
            let mut full = fs::canonicalize(parent).map_err(|err| io("не удалось проверить путь", err))?;
            if full != root && !full.starts_with(root) {
                return Err("путь вне архива".into());
            }
            for part in missing.iter().rev() {
                full = full.join(part);
            }
            return Ok(full);
        }
        current = parent.to_path_buf();
    }
}

fn files_equal(left: &Path, right: &Path) -> bool {
    match (fs::read(left), fs::read(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn read_card(path: &Path) -> BTreeMap<String, String> {
    let Ok(text) = fs::read_to_string(path) else {
        return BTreeMap::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return BTreeMap::new();
    };
    let Some(object) = value.as_object() else {
        return BTreeMap::new();
    };
    let mut fields = BTreeMap::new();
    for (key, value) in object {
        if key.starts_with('_') {
            continue;
        }
        match value {
            serde_json::Value::String(text) if !text.trim().is_empty() => {
                fields.insert(key.clone(), text.trim().to_string());
            }
            serde_json::Value::Number(number) => {
                fields.insert(key.clone(), number.to_string());
            }
            _ => {}
        }
    }
    fields
}

fn write_card(path: &Path, fields: &BTreeMap<String, String>) -> Result<(), String> {
    if fields.is_empty() {
        if path.is_file() {
            fs::remove_file(path).map_err(|err| io("не удалось убрать пустую карточку", err))?;
        }
        return Ok(());
    }
    let mut object = serde_json::Map::new();
    for (key, value) in fields {
        object.insert(key.clone(), serde_json::Value::String(value.clone()));
    }
    let body = serde_json::to_string_pretty(&object).map_err(|err| err.to_string())? + "\n";
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| io("не удалось создать папку карточек", err))?;
    }
    fs::write(path, body).map_err(|err| io("не удалось сохранить карточку", err))
}

fn forget_added_mark(path: &Path) -> Result<(), String> {
    let Ok(text) = fs::read_to_string(path) else {
        return Ok(());
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return Ok(());
    };
    let Some(object) = value.as_object() else {
        return Ok(());
    };
    if !object.keys().any(|key| key.starts_with('_')) {
        return Ok(());
    }
    let mut kept = serde_json::Map::new();
    for (key, item) in object {
        if !key.starts_with('_') {
            kept.insert(key.clone(), item.clone());
        }
    }
    if kept.is_empty() {
        fs::remove_file(path).map_err(|err| io("не удалось убрать метку добавления", err))
    } else {
        let body = serde_json::to_string_pretty(&kept).map_err(|err| err.to_string())? + "\n";
        fs::write(path, body).map_err(|err| io("не удалось убрать метку добавления", err))
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn clean_fields(fields: BTreeMap<String, String>) -> Result<BTreeMap<String, String>, String> {
    if fields.len() > 40 {
        return Err("слишком много полей".into());
    }
    let mut cleaned = BTreeMap::new();
    for (key, value) in fields {
        if key.is_empty()
            || key.starts_with('_')
            || key.len() > 40
            || !key
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
        {
            return Err(format!("недопустимое поле {key}"));
        }
        let value = value.trim();
        if value.chars().count() > 8000 {
            return Err("слишком длинное поле".into());
        }
        if !value.is_empty() {
            cleaned.insert(key, value.to_string());
        }
    }
    Ok(cleaned)
}

fn check_len(path: &Path) -> Result<(), String> {
    if path.to_string_lossy().len() > 240 {
        Err("слишком длинный путь".into())
    } else {
        Ok(())
    }
}

fn path_to_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| "путь не в utf-8".to_string())
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn archive_root() -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let project = manifest
            .parent()
            .ok_or_else(|| "не найден корень проекта".to_string())?;
        return Ok(project.join("Архив"));
    }
    let exe = std::env::current_exe().map_err(|err| io("не удалось найти приложение", err))?;
    let folder = exe
        .parent()
        .ok_or_else(|| "не найдена папка приложения".to_string())?;
    Ok(folder.join("Архив"))
}

fn io(context: &str, err: std::io::Error) -> String {
    format!("{context}: {err}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_archive() -> Archive {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("freedom-archive-{unique}"));
        let _ = fs::remove_dir_all(&root);
        Archive::at(root).unwrap()
    }

    fn write_source(dir: &Path, name: &str) -> PathBuf {
        fs::create_dir_all(dir).unwrap();
        let path = dir.join(name);
        fs::write(&path, b"cover").unwrap();
        path
    }

    #[test]
    fn dotted_titles_keep_separate_cards() {
        let archive = temp_archive();
        archive.ensure_tree().unwrap();
        let source_dir = archive.root().with_extension("src");
        let source = write_source(&source_dir, "cover.png");
        let first = archive
            .add(&source, "аниме", Some("фильмы"), 5, "Атака титанов 3")
            .unwrap();
        let second = archive
            .add(&source, "аниме", Some("фильмы"), 5, "Атака титанов 3. Часть 2")
            .unwrap();
        let mut first_fields = BTreeMap::new();
        first_fields.insert("studio".into(), "WIT".into());
        let mut second_fields = BTreeMap::new();
        second_fields.insert("studio".into(), "MAPPA".into());
        archive.update_card(&first.relative_path, first_fields).unwrap();
        archive.update_card(&second.relative_path, second_fields).unwrap();

        let listed = archive.list().unwrap();
        let first = listed.iter().find(|entry| entry.title == "Атака титанов 3").unwrap();
        let second = listed
            .iter()
            .find(|entry| entry.title == "Атака титанов 3. Часть 2")
            .unwrap();
        assert_eq!(first.fields.get("studio").map(String::as_str), Some("WIT"));
        assert_eq!(second.fields.get("studio").map(String::as_str), Some("MAPPA"));
        assert!(archive
            .root()
            .join("аниме/фильмы/5/карточки/Атака титанов 3.json")
            .is_file());
        assert!(archive
            .root()
            .join("аниме/фильмы/5/карточки/Атака титанов 3. Часть 2.json")
            .is_file());

        let _ = fs::remove_dir_all(archive.root());
        let _ = fs::remove_dir_all(source_dir);
    }

    #[test]
    fn sanitize_removes_forbidden_characters() {
        assert_eq!(sanitize_title("Повелитель").unwrap(), "Повелитель");
        assert_eq!(sanitize_title("a/b:c*?").unwrap(), "a b c");
        assert!(sanitize_title("...").is_err());
        assert!(sanitize_title("CON").is_err());
    }

    #[test]
    fn fetch_cover_rejects_non_http() {
        assert!(fetch_cover("file:///C:/Windows/win.ini").is_err());
        assert!(fetch_cover("not a url").is_err());
        assert!(fetch_cover("").is_err());
    }

    #[test]
    fn fetch_cover_downloads_https_png() {
        let path = fetch_cover(
            "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/120px-PNG_transparency_demonstration_1.png",
        )
        .expect("https download should work with native-tls connector");
        let bytes = fs::read(&path).unwrap();
        let _ = fs::remove_file(&path);
        assert!(image_kind(&bytes).is_some());
    }

    #[test]
    fn tree_uses_category_and_rating_and_skips_other_shelves() {
        let archive = temp_archive();
        archive.ensure_tree().unwrap();
        assert!(archive.root().join("аниме/сериалы/0").is_dir());
        assert!(archive.root().join("аниме/фильмы/5").is_dir());
        assert!(archive.root().join("аниме/хентай/0").is_dir());
        assert!(archive.root().join("аниме/хентай/5").is_dir());
        assert!(!archive.root().join("аниме/манга").exists());
        assert!(archive.root().join("манга/манга/0").is_dir());
        assert!(archive.root().join("манга/хентай/4").is_dir());
        let source_dir = archive.root().with_extension("src");
        let source = write_source(&source_dir, "cover.png");
        let plain = archive.add(&source, "манга", Some("манга"), 2, "Том").unwrap();
        assert_eq!(plain.relative_path, "манга/манга/2/Том.png");
        let adult = archive
            .add(&source, "манга", Some("хентай"), 3, "Том х")
            .unwrap();
        assert_eq!(adult.relative_path, "манга/хентай/3/Том х.png");
        let anime_adult = archive
            .add(&source, "аниме", Some("хентай"), 1, "Серия")
            .unwrap();
        assert_eq!(anime_adult.relative_path, "аниме/хентай/1/Серия.png");
        let _ = fs::remove_dir_all(&source_dir);
        assert!(archive.root().join("кино/фильмы/4").is_dir());
        assert!(archive.root().join("кино/сериалы/1").is_dir());
        assert!(archive.root().join("мульт/мультфильмы/2").is_dir());
        assert!(archive.root().join("мульт/мультсериалы/3").is_dir());
        assert!(!archive.root().join("фильмы").exists());
        assert!(!archive.root().join("сериалы").exists());
        assert!(!archive.root().join("мультфильмы").exists());
        assert!(!archive.root().join("мультсериалы").exists());
        assert!(!archive.root().join("хентай").exists());
        assert!(archive.root().join("игры/пройдено").is_dir());
        assert!(archive.root().join("игры/сыграно").is_dir());
        assert!(archive.root().join("игры/мобильные").is_dir());
        assert!(archive.root().join("игры/dlc").is_dir());
        assert!(archive.root().join("игры/моды").is_dir());
        assert!(archive.root().join("игры/ntfs").is_dir());
        assert!(!archive.root().join("игры/пройдено/0").exists());
        assert!(!archive.root().join("игры/android").exists());
        assert!(!archive.root().join("игры/поиграл").exists());
        assert!(!archive.root().join("кинотеатр").exists());
        assert!(!archive.root().join("концерты").exists());
        let _ = fs::remove_dir_all(archive.root());
    }

    #[test]
    fn manga_shelf_collects_loose_and_anime_manga() {
        let archive = temp_archive();
        let loose = archive.root().join("манга").join("0");
        let anime = archive.root().join("аниме").join("манга").join("5");
        fs::create_dir_all(&loose).unwrap();
        fs::create_dir_all(&anime).unwrap();
        fs::write(loose.join("Том 1.png"), b"cover").unwrap();
        fs::write(anime.join("Том 2.jpg"), b"cover").unwrap();
        archive.ensure_tree().unwrap();
        assert!(archive.root().join("манга/манга/0/Том 1.png").is_file());
        assert!(archive.root().join("манга/манга/5/Том 2.jpg").is_file());
        assert!(!archive.root().join("манга/0").exists());
        assert!(!archive.root().join("аниме/манга").exists());
        let listed = archive.list().unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed.iter().all(|entry| {
            entry.category == "манга" && entry.subcategory.as_deref() == Some("манга")
        }));
        let _ = fs::remove_dir_all(archive.root());
    }

    #[test]
    fn old_screen_categories_move_under_cinema_and_cartoon() {
        let archive = temp_archive();
        let root = archive.root();
        fs::create_dir_all(root.join("фильмы/5")).unwrap();
        fs::write(root.join("фильмы/5/Фильм.png"), b"film").unwrap();
        fs::create_dir_all(root.join("сериалы/4")).unwrap();
        fs::write(root.join("сериалы/4/Сериал.jpg"), b"show").unwrap();
        fs::create_dir_all(root.join("мультфильмы/3")).unwrap();
        fs::write(root.join("мультфильмы/3/Мульт.png"), b"toon").unwrap();
        fs::create_dir_all(root.join("мультсериалы/2")).unwrap();
        fs::write(root.join("мультсериалы/2/Мультсериал.png"), b"series").unwrap();
        fs::create_dir_all(root.join("хентай/манга/5")).unwrap();
        fs::write(root.join("хентай/манга/5/Том.jpg"), b"adult").unwrap();
        fs::create_dir_all(root.join("аниме/фильмы/2")).unwrap();
        fs::write(root.join("аниме/фильмы/2/Аниме.png"), b"anime").unwrap();
        archive.ensure_tree().unwrap();
        assert_eq!(fs::read(root.join("кино/фильмы/5/Фильм.png")).unwrap(), b"film");
        assert_eq!(fs::read(root.join("кино/сериалы/4/Сериал.jpg")).unwrap(), b"show");
        assert_eq!(fs::read(root.join("мульт/мультфильмы/3/Мульт.png")).unwrap(), b"toon");
        assert_eq!(fs::read(root.join("мульт/мультсериалы/2/Мультсериал.png")).unwrap(), b"series");
        assert_eq!(fs::read(root.join("манга/хентай/5/Том.jpg")).unwrap(), b"adult");
        assert_eq!(fs::read(root.join("аниме/фильмы/2/Аниме.png")).unwrap(), b"anime");
        assert!(!root.join("фильмы").exists());
        assert!(!root.join("сериалы").exists());
        assert!(!root.join("мультфильмы").exists());
        assert!(!root.join("мультсериалы").exists());
        assert!(!root.join("хентай").exists());
        let listed = archive.list().unwrap();
        assert!(listed.iter().any(|entry| {
            entry.category == "кино" && entry.subcategory.as_deref() == Some("сериалы") && entry.rating == 4
        }));
        assert!(listed.iter().any(|entry| {
            entry.category == "аниме" && entry.subcategory.as_deref() == Some("фильмы") && entry.title == "Аниме"
        }));
        let _ = fs::remove_dir_all(archive.root());
    }

    #[test]
    fn add_move_and_card_stay_inside_archive() {
        let archive = temp_archive();
        archive.ensure_tree().unwrap();
        let source_dir = archive.root().with_extension("src");
        let source = write_source(&source_dir, "Повелитель.PNG");

        let added = archive
            .add(&source, "аниме", Some("сериалы"), 0, "Повелитель:")
            .unwrap();
        assert_eq!(added.relative_path, "аниме/сериалы/0/Повелитель.png");
        assert!(added.fields.is_empty());
        assert!(source.is_file());
        assert!(archive.root().join("аниме/сериалы/0/Повелитель.png").is_file());
        assert!(!archive.root().join("аниме/сериалы/0/Повелитель.json").exists());

        let mut fields = BTreeMap::new();
        fields.insert("year".into(), "2015".into());
        fields.insert("summary".into(), "  краткое описание  ".into());
        fields.insert("blank".into(), "   ".into());
        let updated = archive.update_card(&added.relative_path, fields).unwrap();
        assert_eq!(updated.fields.get("year").map(String::as_str), Some("2015"));
        assert_eq!(
            updated.fields.get("summary").map(String::as_str),
            Some("краткое описание")
        );
        assert!(!updated.fields.contains_key("blank"));

        let moved = archive
            .move_entry(&added.relative_path, "аниме", Some("сериалы"), 4, "Повелитель 2")
            .unwrap();
        assert_eq!(moved.relative_path, "аниме/сериалы/4/Повелитель 2.png");
        assert_eq!(moved.fields.get("year").map(String::as_str), Some("2015"));
        assert!(!archive.root().join("аниме/сериалы/0/Повелитель.png").exists());
        assert!(archive.root().join("аниме/сериалы/4/карточки/Повелитель 2.json").is_file());
        assert!(!archive.root().join("аниме/сериалы/4/Повелитель 2.json").exists());
        let card = fs::read_to_string(archive.root().join("аниме/сериалы/4/карточки/Повелитель 2.json")).unwrap();
        assert!(!card.contains("_addedAt"));

        let listed = archive.list().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].rating, 4);

        let outside = archive.add(
            &source,
            "../Коллекции",
            None,
            1,
            "Повелитель",
        );
        assert!(outside.is_err());
        assert!(archive.move_entry(&moved.relative_path, "фильмы", Some("лишняя"), 1, "x").is_err());

        let rival = archive
            .add(&source, "аниме", Some("сериалы"), 4, "Сосед")
            .unwrap();
        let mut rival_fields = BTreeMap::new();
        rival_fields.insert("studio".into(), "OLD".into());
        archive.update_card(&rival.relative_path, rival_fields).unwrap();
        let replaced = archive
            .move_entry(&moved.relative_path, "аниме", Some("сериалы"), 4, "Сосед")
            .unwrap();
        assert_eq!(replaced.relative_path, "аниме/сериалы/4/Сосед.png");
        assert_eq!(replaced.fields.get("year").map(String::as_str), Some("2015"));
        assert!(!archive.root().join("аниме/сериалы/4/Повелитель 2.png").exists());
        assert_eq!(archive.list().unwrap().len(), 1);

        let _ = fs::remove_dir_all(archive.root());
        let _ = fs::remove_dir_all(source_dir);
    }

    #[test]
    fn delete_removes_cover_and_card_only() {
        let archive = temp_archive();
        archive.ensure_tree().unwrap();
        let source_dir = archive.root().with_extension("src");
        let source = write_source(&source_dir, "cover.png");

        let removed = archive
            .add(&source, "кино", Some("фильмы"), 2, "Удалить меня")
            .unwrap();
        let kept = archive.add(&source, "кино", Some("фильмы"), 2, "Оставить").unwrap();
        archive.delete_entry(&removed.relative_path).unwrap();

        assert!(!archive.root().join("кино/фильмы/2/Удалить меня.png").exists());
        assert!(!archive.root().join("кино/фильмы/2/карточки/Удалить меня.json").exists());
        assert!(!archive.root().join("кино/фильмы/2/Удалить меня.json").exists());
        assert!(archive.root().join(&kept.relative_path).is_file());
        assert_eq!(archive.list().unwrap().len(), 1);
        assert!(archive.delete_entry("../Коллекции/x.png").is_err());
        assert!(archive.delete_entry(&removed.relative_path).is_err());

        let _ = fs::remove_dir_all(archive.root());
        let _ = fs::remove_dir_all(source_dir);
    }

    #[test]
    fn added_mark_is_not_stored() {
        let archive = temp_archive();
        archive.ensure_tree().unwrap();
        let source_dir = archive.root().with_extension("src");
        let source = write_source(&source_dir, "cover.png");
        let added = archive.add(&source, "кино", Some("фильмы"), 1, "Без метки").unwrap();
        assert!(!archive.root().join("кино/фильмы/1/Без метки.json").exists());

        fs::write(
            archive.root().join("кино/фильмы/1/Старая.json"),
            "{\"_addedAt\": 10, \"summary\": \"текст\"}\n",
        )
        .unwrap();
        fs::write(archive.root().join("кино/фильмы/1/Только.json"), "{\"_addedAt\": 10}\n").unwrap();
        archive.ensure_tree().unwrap();
        let kept = fs::read_to_string(archive.root().join("кино/фильмы/1/карточки/Старая.json")).unwrap();
        assert!(!kept.contains("_addedAt"));
        assert!(kept.contains("текст"));
        assert!(!archive.root().join("кино/фильмы/1/Старая.json").exists());
        assert!(!archive.root().join("кино/фильмы/1/Только.json").exists());
        assert!(!archive.root().join("кино/фильмы/1/карточки/Только.json").exists());

        let mut fields = BTreeMap::new();
        fields.insert("summary".into(), "есть".into());
        archive.update_card(&added.relative_path, fields).unwrap();
        let saved = fs::read_to_string(archive.root().join("кино/фильмы/1/карточки/Без метки.json")).unwrap();
        assert!(!saved.contains("_addedAt"));
        assert!(saved.contains("есть"));
        assert!(!archive.root().join("кино/фильмы/1/Без метки.json").exists());
        archive.update_card(&added.relative_path, BTreeMap::new()).unwrap();
        assert!(!archive.root().join("кино/фильмы/1/карточки/Без метки.json").exists());

        let _ = fs::remove_dir_all(archive.root());
        let _ = fs::remove_dir_all(source_dir);
    }

    #[test]
    fn project_archive_roundtrip_leaves_collections_untouched() {
        let project = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .to_path_buf();
        let collections = project.join("Коллекции");
        let before = count_files(&collections);

        let archive = Archive::open().unwrap();
        archive.ensure_tree().unwrap();
        let source_dir = std::env::temp_dir().join(format!("freedom-archive-src-{}", std::process::id()));
        let source = write_source(&source_dir, "cover.png");
        let title = format!("__проверка_{}", std::process::id());

        struct Cleanup {
            paths: Vec<PathBuf>,
        }
        impl Drop for Cleanup {
            fn drop(&mut self) {
                for path in &self.paths {
                    let _ = fs::remove_file(path);
                    let _ = fs::remove_file(path.with_extension("json"));
                    let _ = fs::remove_file(json_path(path));
                }
            }
        }

        let _guard = Cleanup {
            paths: vec![
                archive
                    .root()
                    .join("игры")
                    .join("пройдено")
                    .join(format!("{title}.png")),
                archive
                    .root()
                    .join("игры")
                    .join("брошено")
                    .join(format!("{title}.png")),
                source.clone(),
            ],
        };

        let added = archive
            .add(&source, "игры", Some("пройдено"), 4, &title)
            .unwrap();
        assert_eq!(added.relative_path, format!("игры/пройдено/{title}.png"));
        assert_eq!(added.rating, 0);
        let moved = archive
            .move_entry(&added.relative_path, "игры", Some("брошено"), 1, &title)
            .unwrap();

        assert_eq!(moved.rating, 0);
        assert_eq!(moved.relative_path, format!("игры/брошено/{title}.png"));
        assert!(moved.image_path.contains("Архив"));
        assert!(!moved.image_path.contains("Коллекции"));
        assert!(archive.root().join("игры/брошено").join(format!("{title}.png")).is_file());
        assert!(!archive.root().join("игры/пройдено").join(format!("{title}.png")).exists());
        assert!(!archive.root().join("игры/пройдено/4").exists());
        assert!(!archive.root().join("игры/брошено/1").exists());
        assert_eq!(count_files(&collections), before);

        drop(_guard);
        let _ = fs::remove_dir_all(&source_dir);
    }

    #[test]
    fn games_flatten_old_shelves_without_overwriting() {
        let archive = temp_archive();
        let root = archive.root().to_path_buf();
        let collections = root.join("Коллекции");
        fs::create_dir_all(collections.join("игры/пройдено/0")).unwrap();
        fs::write(collections.join("игры/пройдено/0/Не трогать.png"), b"keep").unwrap();

        fs::create_dir_all(root.join("игры/пройдено/5")).unwrap();
        fs::write(root.join("игры/пройдено/5/Ведьмак.png"), b"witcher").unwrap();
        fs::write(root.join("игры/пройдено/5/Ведьмак.json"), b"{\"summary\":\"game\"}\n").unwrap();
        fs::write(root.join("игры/пройдено/5/Обложка.jpg"), b"jpg").unwrap();
        fs::write(root.join("игры/пройдено/5/Обложка.json"), b"{\"summary\":\"jpg\"}\n").unwrap();

        fs::create_dir_all(root.join("игры/android/2")).unwrap();
        fs::write(root.join("игры/android/2/Карман.png"), b"phone").unwrap();
        fs::write(root.join("игры/android/2/Карман.json"), b"{}\n").unwrap();

        fs::create_dir_all(root.join("игры/поиграл/0")).unwrap();
        fs::write(root.join("игры/поиграл/0/Одинаковое.png"), b"played").unwrap();
        fs::create_dir_all(root.join("игры/кооп/1")).unwrap();
        fs::write(root.join("игры/кооп/1/Одинаковое.png"), b"coop").unwrap();
        fs::write(root.join("игры/кооп/1/Одинаковое.json"), b"{\"summary\":\"coop\"}\n").unwrap();
        fs::create_dir_all(root.join("игры/старые/3")).unwrap();
        fs::write(root.join("игры/старые/3/Ретро.png"), b"old").unwrap();
        fs::create_dir_all(root.join("игры/не-идет/4")).unwrap();
        fs::write(root.join("игры/не-идет/4/Тормозит.png"), b"slow").unwrap();

        fs::create_dir_all(root.join("игры/моды")).unwrap();
        fs::write(root.join("игры/моды/Уже.png"), b"flat").unwrap();
        fs::create_dir_all(root.join("игры/моды/1")).unwrap();
        fs::write(root.join("игры/моды/1/Уже.png"), b"rated").unwrap();
        fs::write(root.join("игры/моды/1/Уже.json"), b"{\"summary\":\"mod\"}\n").unwrap();

        fs::create_dir_all(root.join("фильмы/2")).unwrap();
        fs::write(root.join("фильмы/2/Фильм.png"), b"film").unwrap();

        archive.ensure_tree().unwrap();

        assert_eq!(fs::read(root.join("игры/пройдено/Ведьмак.png")).unwrap(), b"witcher");
        assert!(fs::read_to_string(root.join("игры/пройдено/карточки/Ведьмак.json")).unwrap().contains("game"));
        assert_eq!(fs::read(root.join("игры/пройдено/Обложка.jpg")).unwrap(), b"jpg");
        assert!(fs::read_to_string(root.join("игры/пройдено/карточки/Обложка.json")).unwrap().contains("jpg"));
        assert!(!root.join("игры/пройдено/Ведьмак.json").exists());
        assert!(!root.join("игры/пройдено/Обложка.json").exists());
        assert!(!root.join("игры/пройдено/5").exists());
        assert!(!root.join("игры/пройдено/0").exists());

        assert_eq!(fs::read(root.join("игры/мобильные/Карман.png")).unwrap(), b"phone");
        assert!(root.join("игры/мобильные/карточки/Карман.json").is_file());
        assert!(!root.join("игры/мобильные/Карман.json").exists());
        assert!(!root.join("игры/android").exists());

        assert_eq!(fs::read(root.join("игры/сыграно/Одинаковое.png")).unwrap(), b"played");
        assert_eq!(fs::read(root.join("игры/сыграно/Одинаковое (2).png")).unwrap(), b"coop");
        assert!(fs::read_to_string(root.join("игры/сыграно/карточки/Одинаковое (2).json")).unwrap().contains("coop"));
        assert!(!root.join("игры/сыграно/Одинаковое.json").exists());
        assert_eq!(fs::read(root.join("игры/сыграно/Ретро.png")).unwrap(), b"old");
        assert_eq!(fs::read(root.join("игры/сыграно/Тормозит.png")).unwrap(), b"slow");
        assert!(!root.join("игры/поиграл").exists());
        assert!(!root.join("игры/кооп").exists());
        assert!(!root.join("игры/старые").exists());
        assert!(!root.join("игры/не-идет").exists());

        assert_eq!(fs::read(root.join("игры/моды/Уже.png")).unwrap(), b"flat");
        assert_eq!(fs::read(root.join("игры/моды/Уже (2).png")).unwrap(), b"rated");
        assert!(fs::read_to_string(root.join("игры/моды/карточки/Уже (2).json")).unwrap().contains("mod"));
        assert!(!root.join("игры/моды/Уже (2).json").exists());
        assert!(!root.join("игры/моды/1").exists());

        assert!(root.join("игры/dlc").is_dir());
        assert!(!root.join("игры/dlc/0").exists());
        assert_eq!(fs::read(root.join("кино/фильмы/2/Фильм.png")).unwrap(), b"film");
        assert!(!root.join("фильмы").exists());
        assert_eq!(fs::read(collections.join("игры/пройдено/0/Не трогать.png")).unwrap(), b"keep");

        archive.ensure_tree().unwrap();
        assert!(!root.join("игры/сыграно/Одинаковое (3).png").exists());
        assert_eq!(fs::read(root.join("игры/пройдено/Ведьмак.png")).unwrap(), b"witcher");

        let source_dir = root.with_extension("src");
        let source = write_source(&source_dir, "cover.png");
        let added = archive.add(&source, "игры", Some("dlc"), 5, "Дополнение").unwrap();
        assert_eq!(added.relative_path, "игры/dlc/Дополнение.png");
        assert_eq!(added.rating, 0);
        assert!(!root.join("игры/dlc/5").exists());
        let listed = archive.list().unwrap();
        assert!(listed.iter().any(|entry| entry.relative_path == "игры/dlc/Дополнение.png" && entry.rating == 0));
        assert!(listed.iter().any(|entry| entry.title == "Ведьмак" && entry.subcategory.as_deref() == Some("пройдено") && entry.rating == 0));
        assert!(archive.add(&source, "игры", Some("android"), 1, "Нет").is_err());

        let _ = fs::remove_dir_all(archive.root());
        let _ = fs::remove_dir_all(source_dir);
    }

    fn count_files(root: &Path) -> usize {
        let mut count = 0;
        let mut stack = vec![root.to_path_buf()];
        while let Some(dir) = stack.pop() {
            let Ok(read) = fs::read_dir(&dir) else {
                continue;
            };
            for item in read.flatten() {
                let path = item.path();
                if path.is_dir() {
                    stack.push(path);
                } else {
                    count += 1;
                }
            }
        }
        count
    }
}
