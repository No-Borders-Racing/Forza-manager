/* Start: watches sign-in and starts the app. */
/* These files share one global scope; they load in the order listed in admin/index.html. */
"use strict";

sb.auth.onAuthStateChange(function (ev) { if (ev === "SIGNED_OUT") showLogin(); });
boot();
