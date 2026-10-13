#import <Cocoa/Cocoa.h>

extern void onegit_updater_start(BOOL (*callback)(void));
extern const char *onegit_updater_status(void);
extern void onegit_updater_check_background(void);
extern void onegit_updater_restart(void);

static BOOL busy;
static BOOL saved;
static BOOL prepareQuit(void) { saved = YES; return YES; }

@interface ProbeDelegate : NSObject <NSApplicationDelegate>
@property NSTimer *timer;
@property NSString *mode;
@property NSString *output;
@property NSUInteger attempts;
@end

@implementation ProbeDelegate
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender { return busy ? NSTerminateCancel : NSTerminateNow; }
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    self.output = [NSBundle.mainBundle objectForInfoDictionaryKey:@"OneGitTestOutput"];
    self.mode = [NSBundle.mainBundle objectForInfoDictionaryKey:@"OneGitTestMode"];
    NSString *version = [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleVersion"];
    [version writeToFile:[self.output stringByAppendingPathComponent:@"launched-version"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
    if ([version isEqualToString:@"0.0.2"]) { [NSApp terminate:nil]; return; }
    onegit_updater_start(prepareQuit);
    self.timer = [NSTimer scheduledTimerWithTimeInterval:0.2 target:self selector:@selector(tick:) userInfo:nil repeats:YES];
}
- (void)tick:(NSTimer *)timer {
    NSString *status = [NSString stringWithUTF8String:onegit_updater_status()];
    [status writeToFile:[self.output stringByAppendingPathComponent:@"status"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
    if ([status isEqualToString:@"idle"] && self.attempts == 0) { self.attempts++; onegit_updater_check_background(); }
    if ([status hasPrefix:@"error:"]) { [NSApp terminate:nil]; return; }
    if (![status isEqualToString:@"ready"]) return;
    if (self.attempts == 1) {
        // A restart request during a Git write must be vetoed without saving/quitting.
        busy = YES;
        onegit_updater_restart();
        self.attempts++;
        return;
    }
    if (self.attempts++ < 5) return;
    [(saved ? @"failed" : @"protected") writeToFile:[self.output stringByAppendingPathComponent:@"veto"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
    busy = NO;
    if ([self.mode isEqualToString:@"restart"]) onegit_updater_restart();
    else [NSApp terminate:nil];
}
- (void)applicationWillTerminate:(NSNotification *)notification {
    if (saved) [@"saved" writeToFile:[self.output stringByAppendingPathComponent:@"draft"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
}
@end

int main(void) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        ProbeDelegate *delegate = [[ProbeDelegate alloc] init];
        NSApp.delegate = delegate;
        NSMenu *menu = [[NSMenu alloc] init];
        NSMenuItem *app = [[NSMenuItem alloc] init];
        app.submenu = [[NSMenu alloc] init];
        [menu addItem:app];
        NSApp.mainMenu = menu;
        [NSApp run];
    }
    return 0;
}
