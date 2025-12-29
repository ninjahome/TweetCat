import {Hono} from "hono";
import {cdpFetch, ExtendedEnv,} from "./common";
import {createKolBinding, getKolBindingByUserId, updateUserSigninTime, ValidatedUserInfo} from "./database";

export function registerUserInfoRoute(app: Hono<ExtendedEnv>) {
	app.get("/user-info", async (c) => {
		try {
			const userId = c.req.query("userId"); // x:12345 或 uuid
			if (!userId) return c.json({error: "Missing userId"}, 400);

			const path = `/platform/v2/end-users/${userId}`;
			const userData = await cdpFetch(c, path, "GET")
			return c.json(userData);

		} catch (err: any) {
			return c.json({error: "Internal Server Error", detail: err?.message}, 500);
		}
	});
}

function parseXAuthEndUserSnapshot(validationResult: any): ValidatedUserInfo {
	const authMethods = validationResult.authenticationMethods || [];
	const xAuth = authMethods.find((m: any) => m.type === "x");
	if (!xAuth) {
		throw new Error("Only X/Twitter authentication is supported")
	}

	const evmAccounts = validationResult.evmAccountObjects || [];
	if (evmAccounts.length === 0) {
		throw new Error("No EVM account found")
	}

	return {
		userId: validationResult.userId,
		walletAddress: evmAccounts[0].address,
		walletCreatedAt: evmAccounts[0].createdAt,
		email: xAuth.email || "",
		xSub: xAuth.sub,
		username: xAuth.username
	}
}

export function registerValidateTokenRoute(app: Hono<ExtendedEnv>) {
	app.post("/validate-token", async (c) => {

		const body = await c.req.json().catch(() => ({}));
		const accessToken = body?.accessToken;
		if (!accessToken) {
			return c.json({error: "Missing accessToken"}, 400);
		}

		const path = `/platform/v2/end-users/auth/validate-token`;
		try {
			const validationResult = await cdpFetch(c, path, "POST", {accessToken: accessToken})
			if (!!validationResult?.error) {
				return c.json(validationResult)
			}

			const userInfo = parseXAuthEndUserSnapshot(validationResult)

			const existingUser = await getKolBindingByUserId(c.env.DB, userInfo.userId);
			if (existingUser) {
				await updateUserSigninTime(c.env.DB, userInfo.xSub);
				return c.json({success: true, isNewUser: false});
			}

			await createKolBinding(c.env.DB, userInfo);

			return c.json({success: true, isNewUser: true});
		} catch (err: any) {
			console.error("[Validate Token Error]", err);
			return c.json({error: "Internal Server Error", detail: err?.message}, 500);
		}
	});
}
