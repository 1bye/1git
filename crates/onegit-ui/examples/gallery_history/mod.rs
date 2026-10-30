//! Stable sample history and a small patch prepared when the selection changes.
use onegit_ui::{CommitItem, CommitListData, CommitRef, CommitRefKind, DiffDocument};

pub fn data(count: usize) -> CommitListData {
    let subjects = [
        "Refine repository surfaces",
        "Remove secondary button borders",
        "Keep selection stable while filtering",
        "Add reusable native inputs",
        "Merge branch feature/日本語 · café",
    ];

    let authors = [
        "Yurii Hulyk",
        "Alex Rivera",
        "Maya Chen",
        "Sam Taylor",
        "Renée Martin",
    ];

    let items = (0..count)
        .map(|index| {
            let hash = format!("{:08x}", 0xc0ff_ee01u64 + index as u64);

            let references = match index {
                0 => vec![
                    CommitRef::new(CommitRefKind::Branch, "main"),
                    CommitRef::new(CommitRefKind::Remote, "origin/main"),
                ],
                1 => vec![CommitRef::new(CommitRefKind::Tag, "v0.2.0")],
                2 => vec![
                    CommitRef::new(CommitRefKind::Branch, "feature/selection"),
                    CommitRef::new(CommitRefKind::Remote, "origin/feature/selection"),
                    CommitRef::new(CommitRefKind::Tag, "preview-2"),
                ],
                _ => Vec::new(),
            };

            CommitItem {
                author: Some(authors[index % authors.len()].into()),
                date: Some(
                    if index < 5 {
                        format!("{} min ago", index * 12 + 2)
                    } else {
                        format!("{} days ago", index / 20 + 1)
                    }
                    .into(),
                ),
                hash: Some(hash.clone().into()),
                references,
                ..CommitItem::new(
                    format!("{hash}{}", "0".repeat(32)),
                    if index < subjects.len() {
                        subjects[index].to_owned()
                    } else {
                        format!("Refine native repository workflow · change {index}")
                    },
                )
            }
        })
        .collect();

    CommitListData::new(items).expect("gallery commit IDs are unique and nonempty")
}

pub fn preview(item: &CommitItem) -> DiffDocument {
    DiffDocument::parse(&format!("@@ -1,2 +1,3 @@\n fn preview() {{\n-    render_previous();\n+    render_commit(\"{}\");\n+    // {}\n", item.hash.as_deref().unwrap_or("sample"),item.summary)).expect("generated gallery patch has matching line counts")
}
