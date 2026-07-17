use serde::{Deserialize, Serialize};

use super::error::SessionError;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionState {
    Created,
    Starting,
    Ready,
    Closing,
    Closed,
    Failed,
}

impl SessionState {
    pub fn transition_to(self, requested: Self) -> Result<Self, SessionError> {
        match (self, requested) {
            (Self::Created, Self::Starting)
            | (Self::Starting, Self::Ready)
            | (Self::Starting, Self::Failed)
            | (Self::Ready, Self::Closing)
            | (Self::Ready, Self::Failed)
            | (Self::Closing, Self::Closed) => Ok(requested),
            (current, requested) => {
                Err(SessionError::InvalidStateTransition { current, requested })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{SessionError, SessionState};

    #[test]
    fn ready_session_can_begin_closing() {
        let next = SessionState::Ready.transition_to(SessionState::Closing);

        assert_eq!(next, Ok(SessionState::Closing));
    }

    #[test]
    fn closed_session_rejects_ready_transition() {
        let result = SessionState::Closed.transition_to(SessionState::Ready);

        assert!(matches!(
            result,
            Err(SessionError::InvalidStateTransition { .. })
        ));
    }

    #[test]
    fn state_serializes_with_stable_camel_case_name() {
        let serialized = serde_json::to_string(&SessionState::Starting).unwrap();

        assert_eq!(serialized, "\"starting\"");
    }
}
