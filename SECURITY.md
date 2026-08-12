# Security policy

Do not report a vulnerability in a public issue.

Use GitHub's private vulnerability reporting for this repository. Include the
affected CLI version, the command or workflow involved, the expected behavior,
and a minimal reproduction that contains no credentials or customer data.

If an OpenPMM API key or webhook signing secret may be exposed, rotate it in
the OpenPMM portal immediately. `openpmm auth logout` removes only the local
credential. It does not revoke the server credential.
