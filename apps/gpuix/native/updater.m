#import <Cocoa/Cocoa.h>
#import <Sparkle/Sparkle.h>
#import <objc/runtime.h>

typedef BOOL (*PrepareQuit)(void);
static PrepareQuit prepareQuit;
static IMP originalShouldTerminate;

// Preserve GPUI's synchronous Git-operation veto, then flush the JS draft.
static NSApplicationTerminateReply shouldTerminate(id self, SEL selector, NSApplication *app) {
    NSApplicationTerminateReply reply = ((NSApplicationTerminateReply (*)(id, SEL, NSApplication *))originalShouldTerminate)(self, selector, app);
    if (reply != NSTerminateNow || !prepareQuit || prepareQuit()) return reply;
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"Workspace could not be saved";
    alert.informativeText = @"Quit was cancelled to preserve your draft. Check available disk space and try again.";
    [alert runModal];
    return NSTerminateCancel;
}

@interface OneGitUpdater : NSObject <SPUUpdaterDelegate, NSMenuItemValidation>
@property SPUStandardUpdaterController *controller;
@property NSMenuItem *restartItem;
@property(copy) void (^installHandler)(void);
@property(copy) NSString *status;
@property BOOL configured;
@end

@implementation OneGitUpdater
- (void)check:(id)sender {
    if (self.configured) [self.controller checkForUpdates:sender];
    else {
        NSAlert *alert = [[NSAlert alloc] init];
        alert.messageText = @"Updates are not configured yet";
        alert.informativeText = @"This build has no published update feed. Install a newer shared build manually for now.";
        [alert runModal];
    }
}
- (void)toggleChecks:(NSMenuItem *)sender { self.controller.updater.automaticallyChecksForUpdates = !self.controller.updater.automaticallyChecksForUpdates; }
- (void)toggleInstallation:(NSMenuItem *)sender { self.controller.updater.automaticallyDownloadsUpdates = !self.controller.updater.automaticallyDownloadsUpdates; }
- (void)restart:(id)sender { if (self.installHandler) self.installHandler(); }
- (BOOL)validateMenuItem:(NSMenuItem *)item {
    if (item.action == @selector(check:)) return !self.configured || self.controller.updater.canCheckForUpdates;
    if (item.action == @selector(restart:)) return self.installHandler != nil;
    if (item.action == @selector(toggleChecks:)) item.state = self.controller.updater.automaticallyChecksForUpdates ? NSControlStateValueOn : NSControlStateValueOff;
    if (item.action == @selector(toggleInstallation:)) {
        item.state = self.controller.updater.automaticallyDownloadsUpdates ? NSControlStateValueOn : NSControlStateValueOff;
        return self.configured && self.controller.updater.allowsAutomaticUpdates;
    }
    return self.configured;
}
- (void)updater:(SPUUpdater *)updater didFindValidUpdate:(SUAppcastItem *)item { self.status = @"downloading"; }
- (BOOL)updater:(SPUUpdater *)updater willInstallUpdateOnQuit:(SUAppcastItem *)item immediateInstallationBlock:(void (^)(void))handler {
    self.installHandler = handler;
    self.status = @"ready";
    self.restartItem.hidden = NO;
    return YES;
}
- (void)updater:(SPUUpdater *)updater didAbortWithError:(NSError *)error { self.status = [@"error: " stringByAppendingString:error.localizedDescription]; }
@end

static OneGitUpdater *owner;

// All AppKit/Sparkle APIs and the Bun callback run on GPUI's main thread.
void onegit_updater_start(PrepareQuit callback) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (owner) return;
        prepareQuit = callback;
        owner = [[OneGitUpdater alloc] init];
        owner.status = @"unconfigured";
        NSBundle *bundle = NSBundle.mainBundle;
        owner.configured = [bundle objectForInfoDictionaryKey:@"SUFeedURL"] != nil && [bundle objectForInfoDictionaryKey:@"SUPublicEDKey"] != nil;
        Method method = class_getInstanceMethod([NSApp.delegate class], @selector(applicationShouldTerminate:));
        if (method) originalShouldTerminate = method_setImplementation(method, (IMP)shouldTerminate);

        NSMenu *menu = [NSApp.mainMenu itemAtIndex:0].submenu;
        NSInteger index = MIN(2, menu.numberOfItems);
        NSArray *titles = @[@"Check for Updates…", @"Automatically Check for Updates", @"Install Updates Automatically on Quit", @"Restart to Update"];
        SEL actions[] = { @selector(check:), @selector(toggleChecks:), @selector(toggleInstallation:), @selector(restart:) };
        for (NSUInteger i = 0; i < titles.count; i++) {
            NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:titles[i] action:actions[i] keyEquivalent:@""];
            item.target = owner;
            [menu insertItem:item atIndex:index++];
            if (i == 3) { owner.restartItem = item; item.hidden = YES; }
        }
        [menu insertItem:NSMenuItem.separatorItem atIndex:index];
        if (owner.configured) {
            owner.controller = [[SPUStandardUpdaterController alloc] initWithStartingUpdater:NO updaterDelegate:owner userDriverDelegate:nil];
            NSError *error;
            if (![owner.controller.updater startUpdater:&error]) owner.status = [@"error: " stringByAppendingString:error.localizedDescription];
            else owner.status = @"idle";
        }
    });
}

// Also usable by a native status surface and the isolated installer regression.
const char *onegit_updater_status(void) { return owner.status.UTF8String ?: "starting"; }
void onegit_updater_check_background(void) { [owner.controller.updater checkForUpdatesInBackground]; }
void onegit_updater_restart(void) { [owner restart:nil]; }
