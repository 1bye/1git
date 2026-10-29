//! External-consumer checks for constructor defaults and markup property compatibility.
use onegit_ui::{
    Button, ButtonTone, ButtonVariant, CheckState, Checkbox, ControlSize, ControlState, Icon,
    IconButton, IconName, ListRow, Pane, RowSelection, Text, TextRole, Theme,
};

#[test]
fn typed_properties_override_constructor_defaults_without_builder_lookup() {
    let button = rake::view! {
        <Button variant={ButtonVariant::Ghost} tone={ButtonTone::Danger}
            size={ControlSize::Small} state={ControlState::Busy}
            {..Button::new("delete","Delete branch")}/>
    };
    assert_eq!(button.label.as_ref(), "Delete branch");
    assert_eq!(button.variant, ButtonVariant::Ghost);
    assert_eq!(button.tone, ButtonTone::Danger);
    assert_eq!(button.size.height(), 24.);
    assert!(!button.state.is_interactive());
    let icon = IconButton::new("refresh", IconName::Refresh, "Refresh repository");
    assert_eq!(icon.label.as_ref(), "Refresh repository");
    assert_eq!(icon.variant, ButtonVariant::Ghost);
    assert!(icon.state.is_interactive());
}

#[test]
fn mixed_checkbox_requests_checked_and_stays_controlled() {
    let control = Checkbox::new("all", "Include all changes");
    assert_eq!(control.checked, CheckState::Unchecked);
    assert_eq!(CheckState::Mixed.toggled(), CheckState::Checked);
    assert_eq!(CheckState::Checked.toggled(), CheckState::Unchecked);
    assert_eq!(control.checked, CheckState::Unchecked);
}

#[test]
fn components_have_independent_defaults_and_debug_output() {
    let row = ListRow::new("row", "theme.rs");
    assert_eq!(row.selection, RowSelection::Unselected);
    assert!(row.leading.is_none() && row.trailing.is_none());
    let text = Text::new("title", "Changes");
    assert_eq!(text.role, TextRole::Body);
    assert_eq!(text.max_lines, None);
    assert!(
        !format!(
            "{row:?} {:?} {:?}",
            Pane::new("pane"),
            Icon::new("icon", IconName::File)
        )
        .is_empty()
    );
    assert_eq!(Theme::dark().body.size, Theme::light().body.size);
    assert_ne!(Theme::dark().surface, Theme::light().surface);
}
