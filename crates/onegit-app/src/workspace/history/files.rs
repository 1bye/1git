//! Committed Git-path grouping; no filesystem reads or changes to file identity.
use onegit_git::CommitFile;

use std::{
    cmp::Ordering,
    collections::{BTreeMap, HashSet},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Entry {
    File(usize),
    Folder(Vec<u8>),
}

#[derive(Clone, Debug)]
pub(super) struct Row {
    pub entry: Entry,
    pub label: String,
    pub depth: usize,
    pub parent: Option<Vec<u8>>,
    pub expanded: Option<bool>,
    pub count: usize,
}

#[derive(Default)]
struct Directory {
    path: Vec<u8>,
    name: Vec<u8>,
    folders: BTreeMap<Vec<u8>, Directory>,
    files: Vec<(usize, Vec<u8>)>,
    count: usize,
}

pub(super) struct Tree(Directory);

impl Tree {
    pub fn new(files: &[CommitFile]) -> Self {
        let mut root = Directory::default();

        for (index, file) in files.iter().enumerate() {
            let mut parts = file.path.as_bytes().split(|&b| b == b'/').peekable();
            let mut directory = &mut root;

            while let Some(part) = parts.next() {
                directory.count += 1;

                if parts.peek().is_none() {
                    directory.files.push((index, part.to_vec()));
                    break;
                }

                let mut path = directory.path.clone();

                if !path.is_empty() {
                    path.push(b'/');
                }

                path.extend_from_slice(part);
                directory = directory
                    .folders
                    .entry(part.to_vec())
                    .or_insert_with(|| Directory {
                        path,
                        name: part.to_vec(),
                        ..Default::default()
                    });
            }
        }

        Self(root)
    }

    pub fn rows(&self, collapsed: &HashSet<Vec<u8>>) -> Vec<Row> {
        let mut rows = Vec::new();

        visit(&self.0, collapsed, 0, None, &mut rows);

        rows
    }
}

fn visit(
    directory: &Directory,
    collapsed: &HashSet<Vec<u8>>,
    depth: usize,
    parent: Option<&[u8]>,
    rows: &mut Vec<Row>,
) {
    let mut folders = directory.folders.values().collect::<Vec<_>>();

    folders.sort_by(|a, b| compare(&a.name, &b.name));

    for mut folder in folders {
        let mut name = folder.name.clone();
        let mut hidden = collapsed.contains(&folder.path);

        while folder.files.is_empty() && folder.folders.len() == 1 {
            folder = folder.folders.values().next().expect("one child directory");
            name.push(b'/');
            name.extend_from_slice(&folder.name);
            hidden |= collapsed.contains(&folder.path);
        }

        rows.push(Row {
            entry: Entry::Folder(folder.path.clone()),
            label: String::from_utf8_lossy(&name).into_owned(),
            depth,
            parent: parent.map(<[u8]>::to_vec),
            expanded: Some(!hidden),
            count: folder.count,
        });

        if !hidden {
            visit(folder, collapsed, depth + 1, Some(&folder.path), rows);
        }
    }

    let mut files = directory.files.iter().collect::<Vec<_>>();

    files.sort_by(|a, b| compare(&a.1, &b.1));
    rows.extend(files.into_iter().map(|(index, name)| Row {
        entry: Entry::File(*index),
        label: String::from_utf8_lossy(name).into_owned(),
        depth,
        parent: parent.map(<[u8]>::to_vec),
        expanded: None,
        count: 0,
    }));
}

// Compare digit runs without integer conversion, including arbitrarily long filenames.
fn compare(a: &[u8], b: &[u8]) -> Ordering {
    let (mut left, mut right) = (a, b);

    while let (Some(&x), Some(&y)) = (left.first(), right.first()) {
        if x.is_ascii_digit() && y.is_ascii_digit() {
            let n = left.iter().take_while(|c| c.is_ascii_digit()).count();
            let m = right.iter().take_while(|c| c.is_ascii_digit()).count();
            let l = trim_zero(&left[..n]);
            let r = trim_zero(&right[..m]);
            let order = l.len().cmp(&r.len()).then_with(|| l.cmp(r));

            if order != Ordering::Equal {
                return order;
            }

            left = &left[n..];
            right = &right[m..];
        } else {
            let order = x.to_ascii_lowercase().cmp(&y.to_ascii_lowercase());

            if order != Ordering::Equal {
                return order;
            }

            left = &left[1..];
            right = &right[1..];
        }
    }

    left.len().cmp(&right.len()).then_with(|| a.cmp(b))
}

fn trim_zero(bytes: &[u8]) -> &[u8] {
    &bytes[bytes.iter().position(|&b| b != b'0').unwrap_or(bytes.len())..]
}

#[cfg(test)]
mod tests {
    use super::*;
    use onegit_git::{FileStatus, GitPath};

    fn file(path: &[u8]) -> CommitFile {
        CommitFile {
            path: GitPath::new(path).unwrap(),
            original_path: None,
            status: FileStatus::Added,
            before_oid: "0".repeat(40),
            after_oid: "1".repeat(40),
        }
    }

    #[test]
    fn groups_raw_git_paths_compresses_directories_and_sorts_numeric_names() {
        let tree = Tree::new(&[
            file(b"src/deep/a10.rs"),
            file(b"src/deep/a2.rs"),
            file(b"src/deep/odd\xff.rs"),
            file(b"root.txt"),
            file(b"other/z.rs"),
        ]);

        let rows = tree.rows(&HashSet::new());

        assert_eq!(
            rows.iter().map(|r| r.label.as_str()).collect::<Vec<_>>(),
            [
                "other",
                "z.rs",
                "src/deep",
                "a2.rs",
                "a10.rs",
                "odd�.rs",
                "root.txt"
            ]
        );
        assert_eq!(rows[3].entry, Entry::File(1));
        assert_eq!(rows[3].parent.as_deref(), Some(b"src/deep".as_slice()));
        let rows = tree.rows(&HashSet::from([b"src".to_vec()]));

        assert_eq!(rows.len(), 4);
        assert_eq!(rows[2].entry, Entry::Folder(b"src/deep".to_vec()));
        assert_eq!(rows[3].depth, 0);
    }
}
