use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemotePathError {
    message: &'static str,
}

impl RemotePathError {
    fn new(message: &'static str) -> Self {
        Self { message }
    }
}

impl fmt::Display for RemotePathError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.message)
    }
}

impl std::error::Error for RemotePathError {}

pub fn normalize_remote_path(path: &str) -> Result<String, RemotePathError> {
    if !path.starts_with('/') || path.contains('\0') {
        return Err(RemotePathError::new("remote path must be absolute"));
    }

    let mut components = Vec::new();
    for component in path.split('/') {
        match component {
            "" | "." => {}
            ".." => {
                components.pop();
            }
            value => components.push(value),
        }
    }

    Ok(if components.is_empty() {
        "/".to_owned()
    } else {
        format!("/{}", components.join("/"))
    })
}

#[cfg(test)]
fn parent_remote_path(path: &str) -> Result<String, RemotePathError> {
    let normalized = normalize_remote_path(path)?;
    if normalized == "/" {
        return Ok(normalized);
    }
    let parent_end = normalized.rfind('/').unwrap_or(0);
    Ok(if parent_end == 0 {
        "/".to_owned()
    } else {
        normalized[..parent_end].to_owned()
    })
}

pub fn join_remote_child(directory: &str, name: &str) -> Result<String, RemotePathError> {
    validate_remote_name(name)?;
    let directory = normalize_remote_path(directory)?;
    let path = if directory == "/" {
        format!("/{name}")
    } else {
        format!("{directory}/{name}")
    };
    normalize_remote_path(&path)
}

fn validate_remote_name(name: &str) -> Result<(), RemotePathError> {
    if name.is_empty()
        || matches!(name, "." | "..")
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
    {
        return Err(RemotePathError::new("remote entry name is invalid"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{join_remote_child, normalize_remote_path, parent_remote_path};

    #[test]
    fn normalizes_absolute_remote_paths() {
        assert_eq!(
            normalize_remote_path("/var/../tmp/./files").unwrap(),
            "/tmp/files"
        );
        assert_eq!(normalize_remote_path("/").unwrap(), "/");
    }

    #[test]
    fn rejects_relative_remote_paths() {
        assert!(normalize_remote_path("tmp/files").is_err());
        assert!(normalize_remote_path("").is_err());
    }

    #[test]
    fn resolves_parent_paths_without_escaping_root() {
        assert_eq!(parent_remote_path("/tmp/files").unwrap(), "/tmp");
        assert_eq!(parent_remote_path("/").unwrap(), "/");
    }

    #[test]
    fn joins_only_a_safe_child_name() {
        assert_eq!(
            join_remote_child("/tmp", "report.txt").unwrap(),
            "/tmp/report.txt"
        );
        assert!(join_remote_child("/tmp", "../secret").is_err());
        assert!(join_remote_child("/tmp", "nested/file").is_err());
        assert!(join_remote_child("/tmp", "nested\\file").is_err());
    }
}
