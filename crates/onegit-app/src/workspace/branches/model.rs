//! Source branch ordering, search and unambiguous local tracking names.
use onegit_git::{Branch, BranchCollection, BranchKind};

pub(super) fn visible(data: &BranchCollection, query: &str, expanded: bool) -> Vec<usize> {
    let tracked = data
        .branches
        .iter()
        .filter(|b| b.kind == BranchKind::Local && b.upstream_remote.as_deref() != Some("."))
        .filter_map(|b| b.upstream.as_deref())
        .collect::<std::collections::HashSet<_>>();

    let mut result = data
        .branches
        .iter()
        .enumerate()
        .filter(|(_, b)| {
            b.kind == BranchKind::Local
                || ![
                    b.name.as_str(),
                    b.full_name.as_str(),
                    b.full_name.strip_prefix("refs/").unwrap_or(&b.full_name),
                ]
                .iter()
                .any(|name| tracked.contains(name))
        })
        .map(|(i, _)| i)
        .collect::<Vec<_>>();

    result.sort_by_key(|&i| {
        if data.branches[i].kind == BranchKind::Local {
            0
        } else {
            1
        }
    });

    if let Some(index) = result.iter().position(|&i| {
        data.branches[i].kind == BranchKind::Local
            && Some(&data.branches[i].name) == data.current.as_ref()
    }) {
        let current = result.remove(index);

        result.insert(0, current);
    }

    let query = query.trim().to_lowercase();

    if !query.is_empty() {
        result.retain(|&i| data.branches[i].name.to_lowercase().contains(&query));
    } else if !expanded {
        result.truncate(3);
    }

    result
}

pub(super) fn remote_target(branch: &Branch, data: &BranchCollection) -> Result<String, String> {
    let prefix = format!(
        "refs/remotes/{}/",
        branch.remote.as_deref().unwrap_or_default()
    );

    let name = branch
        .full_name
        .strip_prefix(&prefix)
        .filter(|name| !name.is_empty());

    let Some(name) = name.filter(|_| branch.kind == BranchKind::Remote && branch.remote.is_some())
    else {
        return Err("This remote branch is unavailable. Refresh and try again.".into());
    };

    if data
        .branches
        .iter()
        .any(|b| b.kind == BranchKind::Local && b.name == name)
    {
        return Err(format!(
            "Local branch “{name}” already exists. Choose it instead."
        ));
    }

    Ok(name.into())
}

/// English relative labels matching the source's numeric-auto formatter for Git's ISO timestamps.
pub(in crate::workspace) fn commit_age(timestamp: Option<&str>, now_ms: i64) -> String {
    let Some(date) = timestamp.and_then(|date| chrono::DateTime::parse_from_rfc3339(date).ok())
    else {
        return String::new();
    };

    let difference = date.timestamp_millis().saturating_sub(now_ms) as f64;

    for (milliseconds, unit) in [
        (31_536_000_000., "year"),
        (2_592_000_000., "month"),
        (86_400_000., "day"),
        (3_600_000., "hour"),
        (60_000., "minute"),
    ] {
        if difference.abs() < milliseconds {
            continue;
        }

        // JavaScript rounds negative half values toward positive infinity.
        let count = (difference / milliseconds + 0.5).floor() as i64;

        return match (unit, count) {
            ("day", -1) => "yesterday".into(),
            ("day", 1) => "tomorrow".into(),
            ("month" | "year", -1) => format!("last {unit}"),
            ("month" | "year", 1) => format!("next {unit}"),
            (_, count) => {
                let amount = count.abs();

                format!(
                    "{}{} {unit}{}{}",
                    if count > 0 { "in " } else { "" },
                    amount,
                    if amount == 1 { "" } else { "s" },
                    if count < 0 { " ago" } else { "" }
                )
            }
        };
    }

    "just now".into()
}

#[cfg(test)]
#[path = "model_tests.rs"]
mod tests;
