import java.io.File;
import java.io.IOException;
import java.security.Key;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.UnrecoverableKeyException;
import java.util.Arrays;

// No input values or exception messages are printed. The original keystore is only read.
class VerifySigning {
    public static void main(String[] args) {
        char[] storePassword = System.getenv("PACK_TOOL_VERIFY_STORE_PASSWORD").toCharArray();
        char[] keyPassword = System.getenv("PACK_TOOL_VERIFY_KEY_PASSWORD").toCharArray();
        String result = "unsupported";
        try {
            KeyStore store;
            try {
                store = KeyStore.getInstance(new File(args[0]), storePassword);
            } catch (IOException error) {
                result = "store-password";
                return;
            }
            if (!store.containsAlias(args[1])) {
                result = "alias";
                return;
            }
            try {
                Key key = store.getKey(args[1], keyPassword);
                result = key instanceof PrivateKey ? "ok" : "private-key";
            } catch (UnrecoverableKeyException error) {
                result = "key-password";
            }
        } catch (Exception error) {
            result = "unsupported";
        } finally {
            Arrays.fill(storePassword, '\0');
            Arrays.fill(keyPassword, '\0');
            System.out.println("PACKTOOL_SIGNING:" + result);
        }
    }
}
