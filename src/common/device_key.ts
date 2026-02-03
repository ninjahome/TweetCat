type DeviceKeyRecord = {
    id: "primary";
    createdAt: number;
    privateKey: CryptoKey;
    publicKey: CryptoKey;
    publicKeySpkiB64: string;
};

const DEVICE_KEY_DB_NAME = "tweetcat-device-key-db";
const DEVICE_KEY_DB_VERSION = 1;
const DEVICE_KEY_STORE = "device_keys";
const DEVICE_KEY_ID: DeviceKeyRecord["id"] = "primary";

let cachedDb: IDBDatabase | null = null;

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function openDeviceKeyDb(): Promise<IDBDatabase> {
    if (cachedDb) return cachedDb;

    cachedDb = await new Promise((resolve, reject) => {
        const request = indexedDB.open(DEVICE_KEY_DB_NAME, DEVICE_KEY_DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(DEVICE_KEY_STORE)) {
                db.createObjectStore(DEVICE_KEY_STORE, {keyPath: "id"});
            }
        };
    });

    return cachedDb;
}

async function getRecord(db: IDBDatabase): Promise<DeviceKeyRecord | null> {
    const tx = db.transaction(DEVICE_KEY_STORE, "readonly");
    const store = tx.objectStore(DEVICE_KEY_STORE);
    const rec = await requestToPromise(store.get(DEVICE_KEY_ID));
    return (rec as DeviceKeyRecord) || null;
}

async function putRecord(db: IDBDatabase, rec: DeviceKeyRecord): Promise<void> {
    const tx = db.transaction(DEVICE_KEY_STORE, "readwrite");
    const store = tx.objectStore(DEVICE_KEY_STORE);
    await requestToPromise(store.put(rec));
}

function abToBase64(ab: ArrayBuffer): string {
    const bytes = new Uint8Array(ab);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function base64ToAb(b64: string): ArrayBuffer {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

async function exportSpkiB64(publicKey: CryptoKey): Promise<string> {
    const spki = await crypto.subtle.exportKey("spki", publicKey);
    return abToBase64(spki);
}

async function generateAndStoreNewDeviceKey(): Promise<DeviceKeyRecord> {
    const keyPair = (await crypto.subtle.generateKey(
        {name: "ECDSA", namedCurve: "P-256"},
        false,
        ["sign", "verify"]
    )) as CryptoKeyPair;

    let publicKeySpkiB64: string;
    try {
        publicKeySpkiB64 = await exportSpkiB64(keyPair.publicKey);
    } catch (e: any) {
        throw new Error(
            `Device Key public key export failed. This browser may not allow exporting SPKI when keyPair extractable=false. (${e?.message || e})`
        );
    }

    const rec: DeviceKeyRecord = {
        id: DEVICE_KEY_ID,
        createdAt: Date.now(),
        privateKey: keyPair.privateKey,
        publicKey: keyPair.publicKey,
        publicKeySpkiB64,
    };

    const db = await openDeviceKeyDb();
    await putRecord(db, rec);
    return rec;
}

export async function ensureDeviceKey(): Promise<DeviceKeyRecord> {
    const db = await openDeviceKeyDb();
    const existing = await getRecord(db);
    if (existing?.privateKey && existing?.publicKey && existing?.publicKeySpkiB64) return existing;
    return await generateAndStoreNewDeviceKey();
}

export async function getDevicePublicKeySpkiB64(): Promise<string> {
    const rec = await ensureDeviceKey();
    return rec.publicKeySpkiB64;
}

export async function signDeviceRequest(params: {
    method: string;
    path: string;
    timestamp: string;
    bodyText: string;
}): Promise<{signatureB64: string; dataToSign: string}> {
    const rec = await ensureDeviceKey();

    const dataToSign = `${params.method.toUpperCase()}\n${params.path}\n${params.timestamp}\n${params.bodyText}`;
    const data = new TextEncoder().encode(dataToSign);

    const sig = await crypto.subtle.sign(
        {name: "ECDSA", hash: "SHA-256"},
        rec.privateKey,
        data
    );

    return {signatureB64: abToBase64(sig), dataToSign};
}

export async function verifyDeviceSignature(params: {
    publicKeySpkiB64: string;
    signatureB64: string;
    method: string;
    path: string;
    timestamp: string;
    bodyText: string;
}): Promise<boolean> {
    const publicKey = await crypto.subtle.importKey(
        "spki",
        base64ToAb(params.publicKeySpkiB64),
        {name: "ECDSA", namedCurve: "P-256"},
        false,
        ["verify"]
    );

    const dataToSign = `${params.method.toUpperCase()}\n${params.path}\n${params.timestamp}\n${params.bodyText}`;
    const data = new TextEncoder().encode(dataToSign);
    return await crypto.subtle.verify(
        {name: "ECDSA", hash: "SHA-256"},
        publicKey,
        base64ToAb(params.signatureB64),
        data
    );
}

