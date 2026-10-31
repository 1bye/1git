use rake::gpui::{self, ElementId, SharedString, prelude::*, px};

/// Built-in SVG glyphs rasterized through GPUI’s cached, GPU-painted icon masks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IconName {
    /// Saved library folder.
    LibraryFolder,
    /// Star a repository.
    Star,
    /// Starred repository.
    StarFilled,
    /// Forget a saved library entry.
    Broom,
    /// Outgoing commits.
    ArrowUp,
    /// Saved work.
    Stashes,
    /// Commit graph.
    Graph,
    /// AI commit message action.
    Sparkles,
    /// Branch/worktree navigation.
    Branches,
    /// Local computer.
    Computer,
    /// Saved remote machine.
    Server,
    /// Repository tile layout.
    Grid,
    /// Repository list layout.
    List,
    /// Back to the folder library.
    Back,
    /// Account menu.
    Account,
    /// More actions.
    More,
    /// Home/repository library.
    Home,
    /// Working-tree changes.
    Changes,
    /// Commit history.
    History,
    /// Workspace appearance/settings.
    Settings,
    /// Diff display options.
    Sliders,
    /// Added-file status.
    FileAdded,
    /// Deleted-file status.
    FileDeleted,
    /// Modified-file status.
    FileModified,
    /// Renamed-file status.
    FileRenamed,
    /// Confirm or checked state.
    Check,
    /// Mixed checkbox state.
    Minus,
    /// Add something.
    Plus,
    /// Close or remove.
    Close,
    /// Error or important warning.
    Alert,
    /// Refresh/retry.
    Refresh,
    /// Search or filter.
    Search,
    /// Expand a menu.
    ChevronDown,
    /// Source branch.
    Branch,
    /// File/document.
    File,
    /// Folder.
    Folder,
    /// Light appearance.
    Sun,
    /// In-progress work, without implying a percentage.
    Working,
}

/// Native logical-pixel glyph size.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum IconSize {
    /// Fourteen-pixel library action.
    Supporting,
    /// Twenty-four-pixel folder control.
    Prominent,
    /// Twenty-eight-pixel library folder.
    Folder,
    /// Twelve-pixel supporting glyph.
    Small,
    /// Sixteen-pixel standard glyph.
    #[default]
    Medium,
    /// Eighteen-pixel workspace navigation glyph.
    Navigation,
    /// Twenty-pixel prominent glyph.
    Large,
}

impl IconSize {
    /// Logical-pixel dimension, identical on both palettes.
    #[must_use]
    pub const fn pixels(self) -> f32 {
        match self {
            Self::Supporting => 14.,
            Self::Prominent => 24.,
            Self::Folder => 28.,
            Self::Small => 12.,
            Self::Medium => 16.,
            Self::Large => 20.,
            Self::Navigation => 18.,
        }
    }
}

/// A crisp monochrome glyph inheriting its parent's foreground color.
#[derive(Debug, IntoElement)]
pub struct Icon {
    /// Stable component root identity.
    pub id: ElementId,
    /// Built-in embedded SVG.
    pub name: IconName,
    /// Logical-pixel size.
    pub size: IconSize,
    /// Optional standalone accessible label; omit for decorative control glyphs.
    pub label: Option<SharedString>,
}

impl Icon {
    /// Create a decorative standard-size glyph.
    #[must_use]
    pub fn new(id: impl Into<ElementId>, name: IconName) -> Self {
        Self {
            id: id.into(),
            name,
            size: IconSize::Medium,
            label: None,
        }
    }
}

impl RenderOnce for Icon {
    fn render(self, _: &mut gpui::Window, _: &mut gpui::App) -> impl IntoElement {
        let dimension = px(self.size.pixels());
        let name = self.name;
        let labelled = self.label.as_ref().is_some_and(|s| !s.is_empty());

        rake::view! {
            <span id={self.id} class="shrink-0" aria-label={self.label.unwrap_or_default()}
                style={|s| s.size(dimension).when(name==IconName::LibraryFolder,|s|s.h(px(24.))).when(labelled, |s| s.role(gpui::accesskit::Role::Image))}>
                {gpui::canvas(|_, _, _| {}, move |bounds, _, window, cx| {
                    let (key,data)=name.source();
                    window.paint_svg(bounds, key.into(),Some(data),Default::default(),window.text_style().color,cx).expect("built-in 1git SVG icon is valid");
                }).size_full()}
            </span>
        }
    }
}

impl IconName {
    fn source(self) -> (&'static str, &'static [u8]) {
        match self {
            Self::LibraryFolder => (
                "onegit-ui/LibraryFolder",
                include_bytes!("icons/LibraryFolder.svg"),
            ),
            Self::Star => ("onegit-ui/Star", include_bytes!("icons/Star.svg")),
            Self::StarFilled => (
                "onegit-ui/StarFilled",
                include_bytes!("icons/StarFilled.svg"),
            ),
            Self::Broom => ("onegit-ui/Broom", include_bytes!("icons/Broom.svg")),
            Self::More => ("onegit-ui/More", include_bytes!("icons/More.svg")),
            Self::Branches => ("onegit-ui/Branches", include_bytes!("icons/Branches.svg")),
            Self::Home => ("onegit-ui/Home", include_bytes!("icons/Home.svg")),
            Self::Plus => ("onegit-ui/Plus", include_bytes!("icons/Plus.svg")),
            Self::Close => ("onegit-ui/Close", include_bytes!("icons/Close.svg")),
            Self::Refresh => ("onegit-ui/Refresh", include_bytes!("icons/Refresh.svg")),
            Self::Branch => ("onegit-ui/Branch", include_bytes!("icons/Branch.svg")),
            Self::Check => ("onegit-ui/Check", include_bytes!("icons/Check.svg")),
            Self::ChevronDown => (
                "onegit-ui/ChevronDown",
                include_bytes!("icons/ChevronDown.svg"),
            ),
            Self::Sparkles => ("onegit-ui/Sparkles", include_bytes!("icons/Sparkles.svg")),
            Self::ArrowUp => ("onegit-ui/ArrowUp", include_bytes!("icons/ArrowUp.svg")),
            Self::Settings => ("onegit-ui/Settings", include_bytes!("icons/Settings.svg")),
            Self::Changes => ("onegit-ui/Changes", include_bytes!("icons/Changes.svg")),
            Self::History => ("onegit-ui/History", include_bytes!("icons/History.svg")),
            Self::Stashes => ("onegit-ui/Stashes", include_bytes!("icons/Stashes.svg")),
            Self::Graph => ("onegit-ui/Graph", include_bytes!("icons/Graph.svg")),
            Self::Computer => ("onegit-ui/Computer", include_bytes!("icons/Computer.svg")),
            Self::Server => ("onegit-ui/Server", include_bytes!("icons/Server.svg")),
            Self::Grid => ("onegit-ui/Grid", include_bytes!("icons/Grid.svg")),
            Self::List => ("onegit-ui/List", include_bytes!("icons/List.svg")),
            Self::Back => ("onegit-ui/Back", include_bytes!("icons/Back.svg")),
            Self::Search => ("onegit-ui/Search", include_bytes!("icons/Search.svg")),
            Self::Account => ("onegit-ui/Account", include_bytes!("icons/Account.svg")),
            Self::Folder => ("onegit-ui/Folder", include_bytes!("icons/Folder.svg")),
            Self::FileModified => (
                "onegit-ui/FileModified",
                include_bytes!("icons/FileModified.svg"),
            ),
            Self::FileAdded => ("onegit-ui/FileAdded", include_bytes!("icons/FileAdded.svg")),
            Self::FileDeleted => (
                "onegit-ui/FileDeleted",
                include_bytes!("icons/FileDeleted.svg"),
            ),
            Self::FileRenamed => (
                "onegit-ui/FileRenamed",
                include_bytes!("icons/FileRenamed.svg"),
            ),
            Self::Minus => ("onegit-ui/Minus", include_bytes!("icons/Minus.svg")),
            Self::Alert => ("onegit-ui/Alert", include_bytes!("icons/Alert.svg")),
            Self::File => ("onegit-ui/File", include_bytes!("icons/File.svg")),
            Self::Sliders => ("onegit-ui/Sliders", include_bytes!("icons/Sliders.svg")),
            Self::Sun => ("onegit-ui/Sun", include_bytes!("icons/Sun.svg")),
            Self::Working => ("onegit-ui/Working", include_bytes!("icons/Working.svg")),
        }
    }
}
