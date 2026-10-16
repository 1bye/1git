#import <Foundation/Foundation.h>
#import <Security/Security.h>

// Only used with an explicitly supplied disposable Keychain and synthetic credential.
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 4) return 2;
        SecKeychainSetUserInteractionAllowed(false);
        SecKeychainRef keychain = NULL;
        OSStatus status = SecKeychainOpen(argv[1], &keychain);
        if (status != errSecSuccess) return 3;
        NSString *server = [NSString stringWithUTF8String:argv[2]];
        NSString *action = [NSString stringWithUTF8String:argv[3]];
        NSDictionary *query = @{
            (__bridge id)kSecClass: (__bridge id)kSecClassInternetPassword,
            (__bridge id)kSecAttrServer: server,
            (__bridge id)kSecMatchSearchList: @[(__bridge id)keychain],
        };
        NSString *value = @"";
        if ([action isEqualToString:@"create"]) {
            NSMutableDictionary *attributes = [query mutableCopy];
            [attributes removeObjectForKey:(__bridge id)kSecMatchSearchList];
            attributes[(__bridge id)kSecUseKeychain] = (__bridge id)keychain;
            attributes[(__bridge id)kSecAttrAccount] = @"1git-synthetic";
            attributes[(__bridge id)kSecValueData] = [@"synthetic-chatgpt-session" dataUsingEncoding:NSUTF8StringEncoding];
            status = SecItemAdd((__bridge CFDictionaryRef)attributes, NULL);
        } else if ([action isEqualToString:@"delete"]) {
            status = SecItemDelete((__bridge CFDictionaryRef)query);
        } else {
            NSMutableDictionary *attributes = [query mutableCopy];
            attributes[(__bridge id)kSecReturnData] = @YES;
            attributes[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
            CFTypeRef result = NULL;
            status = SecItemCopyMatching((__bridge CFDictionaryRef)attributes, &result);
            if (result) {
                NSData *data = CFBridgingRelease(result);
                value = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"";
            }
        }
        CFRelease(keychain);
        NSData *json = [NSJSONSerialization dataWithJSONObject:@{@"status": @(status), @"value": value} options:0 error:NULL];
        fwrite(json.bytes, 1, json.length, stdout);
        return 0;
    }
}
