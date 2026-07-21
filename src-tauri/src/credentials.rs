use std::collections::HashMap;

const CONNECTION_PASSWORD_TARGET_PREFIX: &str = "FleurTerm/ConnectionPassword/";

trait ConnectionPasswordBackend {
    fn read(&self, connection_id: &str) -> Result<Option<String>, String>;
    fn write(&self, connection_id: &str, password: &str) -> Result<(), String>;
    fn remove(&self, connection_id: &str) -> Result<(), String>;
}

struct SystemConnectionPasswordBackend;

impl ConnectionPasswordBackend for SystemConnectionPasswordBackend {
    fn read(&self, connection_id: &str) -> Result<Option<String>, String> {
        read_connection_password(connection_id)
    }

    fn write(&self, connection_id: &str, password: &str) -> Result<(), String> {
        write_connection_password(connection_id, password)
    }

    fn remove(&self, connection_id: &str) -> Result<(), String> {
        remove_connection_password(connection_id)
    }
}

pub fn load_connection_passwords(
    connection_ids: &[String],
) -> Result<HashMap<String, String>, String> {
    load_passwords_with_backend(&SystemConnectionPasswordBackend, connection_ids)
}

pub fn save_connection_password(connection_id: &str, password: &str) -> Result<(), String> {
    save_password_with_backend(&SystemConnectionPasswordBackend, connection_id, password)
}

pub fn delete_connection_password(connection_id: &str) -> Result<(), String> {
    delete_password_with_backend(&SystemConnectionPasswordBackend, connection_id)
}

fn load_passwords_with_backend<B: ConnectionPasswordBackend>(
    backend: &B,
    connection_ids: &[String],
) -> Result<HashMap<String, String>, String> {
    connection_ids
        .iter()
        .map(|connection_id| {
            backend
                .read(connection_id)
                .map(|password| password.map(|value| (connection_id.clone(), value)))
        })
        .filter_map(|result| result.transpose())
        .collect()
}

fn save_password_with_backend<B: ConnectionPasswordBackend>(
    backend: &B,
    connection_id: &str,
    password: &str,
) -> Result<(), String> {
    backend.write(connection_id, password)
}

fn delete_password_with_backend<B: ConnectionPasswordBackend>(
    backend: &B,
    connection_id: &str,
) -> Result<(), String> {
    backend.remove(connection_id)
}

fn password_target(connection_id: &str) -> String {
    format!("{CONNECTION_PASSWORD_TARGET_PREFIX}{connection_id}")
}

fn read_connection_password(connection_id: &str) -> Result<Option<String>, String> {
    use windows::{
        Win32::Security::Credentials::{CRED_TYPE_GENERIC, CredFree, CredReadW},
        core::PCWSTR,
    };

    let target = wide(&password_target(connection_id));
    let mut credential = std::ptr::null_mut();
    unsafe {
        match CredReadW(
            PCWSTR(target.as_ptr()),
            CRED_TYPE_GENERIC,
            None,
            &mut credential,
        ) {
            Ok(()) if !credential.is_null() => {
                let entry = &*credential;
                let bytes = std::slice::from_raw_parts(
                    entry.CredentialBlob,
                    entry.CredentialBlobSize as usize,
                );
                let result = String::from_utf8(bytes.to_vec())
                    .map(Some)
                    .map_err(|error| error.to_string());
                CredFree(credential.cast());
                result
            }
            Ok(()) => Ok(None),
            Err(error) if matches!(error.code().0 as u32, 1168 | 0x80070490) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }
}

fn write_connection_password(connection_id: &str, password: &str) -> Result<(), String> {
    use windows::{
        Win32::Security::Credentials::{
            CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW, CredWriteW,
        },
        core::PWSTR,
    };

    let target = wide(&password_target(connection_id));
    let user = wide("FleurTerm");
    let mut secret = password.as_bytes().to_vec();
    let credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(target.as_ptr() as *mut _),
        CredentialBlobSize: secret.len() as u32,
        CredentialBlob: secret.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        UserName: PWSTR(user.as_ptr() as *mut _),
        ..Default::default()
    };
    unsafe { CredWriteW(&credential, 0).map_err(|error| error.to_string()) }
}

fn remove_connection_password(connection_id: &str) -> Result<(), String> {
    use windows::{
        Win32::Security::Credentials::{CRED_TYPE_GENERIC, CredDeleteW},
        core::PCWSTR,
    };

    let target = wide(&password_target(connection_id));
    unsafe {
        match CredDeleteW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None) {
            Ok(()) => Ok(()),
            Err(error) if matches!(error.code().0 as u32, 1168 | 0x80070490) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, collections::HashMap};

    use super::{
        ConnectionPasswordBackend, delete_password_with_backend, load_passwords_with_backend,
        save_password_with_backend,
    };

    struct RecordingBackend {
        passwords: HashMap<String, String>,
        read_error: Option<String>,
        saved: RefCell<Vec<(String, String)>>,
        deleted: RefCell<Vec<String>>,
    }

    impl ConnectionPasswordBackend for RecordingBackend {
        fn read(&self, connection_id: &str) -> Result<Option<String>, String> {
            if let Some(error) = &self.read_error {
                return Err(error.clone());
            }
            Ok(self.passwords.get(connection_id).cloned())
        }

        fn write(&self, connection_id: &str, password: &str) -> Result<(), String> {
            self.saved
                .borrow_mut()
                .push((connection_id.to_string(), password.to_string()));
            Ok(())
        }

        fn remove(&self, connection_id: &str) -> Result<(), String> {
            self.deleted.borrow_mut().push(connection_id.to_string());
            Ok(())
        }
    }

    #[test]
    fn loads_existing_passwords_and_omits_missing_entries() {
        let backend = RecordingBackend {
            passwords: HashMap::from([("server-a".to_string(), "secret".to_string())]),
            read_error: None,
            saved: RefCell::new(Vec::new()),
            deleted: RefCell::new(Vec::new()),
        };

        let passwords = load_passwords_with_backend(
            &backend,
            &["server-a".to_string(), "server-b".to_string()],
        )
        .expect("password loading should succeed");

        assert_eq!(
            passwords.get("server-a").map(String::as_str),
            Some("secret")
        );
        assert!(!passwords.contains_key("server-b"));
    }

    #[test]
    fn propagates_backend_read_errors() {
        let backend = RecordingBackend {
            passwords: HashMap::new(),
            read_error: Some("vault unavailable".to_string()),
            saved: RefCell::new(Vec::new()),
            deleted: RefCell::new(Vec::new()),
        };

        let result = load_passwords_with_backend(&backend, &["server-a".to_string()]);

        assert_eq!(result, Err("vault unavailable".to_string()));
    }

    #[test]
    fn delegates_password_save_and_delete_to_the_backend() {
        let backend = RecordingBackend {
            passwords: HashMap::new(),
            read_error: None,
            saved: RefCell::new(Vec::new()),
            deleted: RefCell::new(Vec::new()),
        };

        save_password_with_backend(&backend, "server-a", "secret")
            .expect("password saving should succeed");
        delete_password_with_backend(&backend, "server-a")
            .expect("password deletion should succeed");

        assert_eq!(
            backend.saved.into_inner(),
            vec![("server-a".to_string(), "secret".to_string())]
        );
        assert_eq!(backend.deleted.into_inner(), vec!["server-a".to_string()]);
    }
}
