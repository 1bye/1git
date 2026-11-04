//! Window-owned hosting identities and secure, explicitly accepted connections.
mod cli;
mod http;
mod model;
mod oauth;
mod service;
mod store;
#[cfg(test)]
mod tests;
mod vault;

mod panel;
mod view;

pub(crate) use panel::Panel;

#[cfg(all(test, feature = "test-support"))]
mod service_tests;

#[cfg(all(test, feature = "test-support"))]
mod panel_tests;
