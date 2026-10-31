//! Reconnect owner-retained models to the current view while their component is mounted.
use rake::gpui;

pub(crate) fn observe<T: 'static>(
    id: &gpui::ElementId,
    model: &gpui::Entity<T>,
    window: &mut gpui::Window,
    cx: &mut gpui::App,
) {
    window.with_element_namespace(id.clone(), |window| {
        let binding = window.use_keyed_state("retained-model", cx, |_, _| {
            None::<(gpui::EntityId, gpui::Subscription)>
        });

        binding.update(cx, |binding, cx| {
            if binding
                .as_ref()
                .is_none_or(|(id, _)| *id != model.entity_id())
            {
                *binding = Some((model.entity_id(), cx.observe(model, |_, _, cx| cx.notify())));
            }
        });
    });
}
