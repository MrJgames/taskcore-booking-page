# Google Workspace Integration

Google Workspace access should use OAuth and request only the services and permissions needed for the agreed workflows.

## Connection checklist

1. Confirm the Workspace domain and services needed.
2. Define exactly what Taskcore should read, create, update, or send.
3. Create or select a Google Cloud project owned by the business.
4. Configure the OAuth consent screen and authorized redirect URLs.
5. Store the client ID and secret outside source control.
6. Test with a limited account before enabling broader Workspace access.
7. Document token revocation, offboarding, and incident response.

Do not place downloaded OAuth credentials or service-account files in this repository.
