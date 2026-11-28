//! Offline QQ login model. No IPC or network is registered in this phase.
#![allow(dead_code)]

const SERVICE: &str = "xianyu.qqmusic";
const USER: &str = "session";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoginState {
    Idle,
    WaitingScan,
    WaitingConfirmation,
    AwaitingUserAuthorization,
    AwaitingCallback,
    Exchanging,
    LoggedIn,
    Expired,
    Refused,
    Failed,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoginEvent {
    Start,
    Scanned,
    Confirmed,
    AuthorizationPageRequired,
    UserCompleted,
    ValidatedCallback,
    Authenticated,
    RestoreValid,
    Expired,
    Refused,
    Failure,
    Cancel,
    Logout,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoginError {
    InvalidTransition,
    Network,
    Timeout,
    SecurityCheck,
    InvalidCredential,
    Storage,
}

pub fn transition(state: LoginState, event: LoginEvent) -> Result<LoginState, LoginError> {
    use LoginEvent as E;
    use LoginState as S;
    match (state, event) {
        (S::Idle | S::Expired | S::Refused | S::Failed, E::Start) => Ok(S::WaitingScan),
        (S::WaitingScan, E::Scanned) => Ok(S::WaitingConfirmation),
        (S::WaitingConfirmation, E::Confirmed) => Ok(S::Exchanging),
        // Merely seeing a page or clicking a UI control never authenticates an account.
        (S::Exchanging, E::AuthorizationPageRequired) => Ok(S::AwaitingUserAuthorization),
        (S::AwaitingUserAuthorization, E::UserCompleted) => Ok(S::AwaitingCallback),
        (S::AwaitingCallback, E::ValidatedCallback) => Ok(S::Exchanging),
        (S::Exchanging, E::Authenticated) | (S::Idle, E::RestoreValid) => Ok(S::LoggedIn),
        (S::Idle | S::LoggedIn, E::Expired) => Ok(S::Expired),
        (
            S::WaitingScan
            | S::WaitingConfirmation
            | S::AwaitingUserAuthorization
            | S::AwaitingCallback
            | S::Exchanging,
            E::Expired,
        ) => Ok(S::Expired),
        (
            S::WaitingScan
            | S::WaitingConfirmation
            | S::AwaitingUserAuthorization
            | S::AwaitingCallback
            | S::Exchanging,
            E::Refused,
        ) => Ok(S::Refused),
        (
            S::WaitingScan
            | S::WaitingConfirmation
            | S::AwaitingUserAuthorization
            | S::AwaitingCallback
            | S::Exchanging,
            E::Failure,
        ) => Ok(S::Failed),
        (
            S::WaitingScan
            | S::WaitingConfirmation
            | S::AwaitingUserAuthorization
            | S::AwaitingCallback
            | S::Exchanging,
            E::Cancel,
        )
        | (S::LoggedIn, E::Logout) => Ok(S::Idle),
        _ => Err(LoginError::InvalidTransition),
    }
}

// Deliberately not Debug/Serialize: credentials never cross IPC or logs.
pub struct Credential(String);
impl Credential {
    pub fn new(value: String) -> Result<Self, LoginError> {
        if value.is_empty() {
            Err(LoginError::InvalidCredential)
        } else {
            Ok(Self(value))
        }
    }
    pub(crate) fn expose(&self) -> &str {
        &self.0
    }
}
pub trait CredentialStore {
    fn save(&self, credential: &Credential) -> Result<(), LoginError>;
    fn load(&self) -> Result<Option<Credential>, LoginError>;
    fn clear(&self) -> Result<(), LoginError>;
}
pub struct SystemCredentialStore;
impl CredentialStore for SystemCredentialStore {
    fn save(&self, credential: &Credential) -> Result<(), LoginError> {
        keyring::Entry::new(SERVICE, USER)
            .map_err(|_| LoginError::Storage)?
            .set_password(&credential.0)
            .map_err(|_| LoginError::Storage)
    }
    fn load(&self) -> Result<Option<Credential>, LoginError> {
        match keyring::Entry::new(SERVICE, USER)
            .map_err(|_| LoginError::Storage)?
            .get_password()
        {
            Ok(value) => Credential::new(value).map(Some),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(LoginError::Storage),
        }
    }
    fn clear(&self) -> Result<(), LoginError> {
        match keyring::Entry::new(SERVICE, USER)
            .map_err(|_| LoginError::Storage)?
            .delete_credential()
        {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(LoginError::Storage),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    #[derive(Default)]
    struct MemoryStore(RefCell<Option<String>>);
    impl CredentialStore for MemoryStore {
        fn save(&self, c: &Credential) -> Result<(), LoginError> {
            *self.0.borrow_mut() = Some(c.0.clone());
            Ok(())
        }
        fn load(&self) -> Result<Option<Credential>, LoginError> {
            self.0.borrow().clone().map(Credential::new).transpose()
        }
        fn clear(&self) -> Result<(), LoginError> {
            *self.0.borrow_mut() = None;
            Ok(())
        }
    }
    #[test]
    fn state_machine_rejects_out_of_order_events() {
        use LoginEvent as E;
        use LoginState as S;
        let mut state = S::Idle;
        for (event, expected) in [
            (E::Start, S::WaitingScan),
            (E::Scanned, S::WaitingConfirmation),
            (E::Confirmed, S::Exchanging),
            (E::Authenticated, S::LoggedIn),
            (E::Logout, S::Idle),
        ] {
            state = transition(state, event).unwrap();
            assert_eq!(state, expected)
        }
        assert_eq!(
            transition(S::Idle, E::Authenticated),
            Err(LoginError::InvalidTransition)
        );
        assert_eq!(transition(S::Idle, E::RestoreValid), Ok(S::LoggedIn));
        assert_eq!(transition(S::LoggedIn, E::Expired), Ok(S::Expired));
        for event in [E::Expired, E::Refused, E::Failure, E::Cancel] {
            assert!(transition(S::WaitingScan, event).is_ok())
        }
    }

    #[test]
    fn user_page_never_implies_login_or_exchange() {
        use LoginEvent as E;
        use LoginState as S;
        assert_eq!(
            transition(S::Exchanging, E::AuthorizationPageRequired),
            Ok(S::AwaitingUserAuthorization)
        );
        for event in [E::Authenticated, E::ValidatedCallback] {
            assert_eq!(
                transition(S::AwaitingUserAuthorization, event),
                Err(LoginError::InvalidTransition)
            );
        }
        let waiting = transition(S::AwaitingUserAuthorization, E::UserCompleted).unwrap();
        assert_eq!(waiting, S::AwaitingCallback);
        assert_eq!(
            transition(waiting, E::Authenticated),
            Err(LoginError::InvalidTransition)
        );
        assert_eq!(transition(waiting, E::ValidatedCallback), Ok(S::Exchanging));
        for state in [S::AwaitingUserAuthorization, S::AwaitingCallback] {
            assert_eq!(transition(state, E::Cancel), Ok(S::Idle));
            assert_eq!(transition(state, E::Expired), Ok(S::Expired));
            assert_eq!(transition(state, E::Refused), Ok(S::Refused));
            assert_eq!(transition(state, E::Failure), Ok(S::Failed));
        }
        for state in [S::Idle, S::Expired, S::Refused, S::Failed] {
            for event in [E::ValidatedCallback, E::UserCompleted, E::Authenticated] {
                assert_eq!(transition(state, event), Err(LoginError::InvalidTransition));
            }
        }
    }
    #[test]
    fn storage_roundtrip_is_local_and_isolated() {
        let s = MemoryStore::default();
        assert!(s.load().unwrap().is_none());
        s.save(&Credential::new("synthetic-only".into()).unwrap())
            .unwrap();
        assert!(s.load().unwrap().is_some());
        s.clear().unwrap();
        assert!(s.load().unwrap().is_none());
        assert!(Credential::new(String::new()).is_err());
        assert_ne!((SERVICE, USER), ("local.xianyu.music", "netease-session"));
    }
}
