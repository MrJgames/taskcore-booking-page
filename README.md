# TaskCore Booking Page

A mobile-first, one-page website for TaskCore. It uses only HTML, CSS, and vanilla JavaScript, so it can be hosted free with GitHub Pages.

Version 2 provides an app-style customer portal, a text-ready appointment request, temporary photo previews, and an installable offline experience. The site remains fully static and requires no backend.

## 1. Open the site locally

The simplest option is to double-click `index.html`. For the most accurate test, open PowerShell in this folder and run:

```powershell
py -m http.server 8000
```

Then open `http://localhost:8000` in a browser. Keep the PowerShell window open while testing. Press `Ctrl+C` to stop the server.

## 2. Add the Google booking link

Open `config.js` in Notepad. Paste the full Google Form or Google Calendar appointment link between the quotation marks:

```javascript
const TASKCORE_BOOKING_URL = "PASTE THE FULL GOOGLE LINK HERE";
```

Save the file. When this value is blank, the booking button smoothly moves the customer to the quote request form. When it contains a link, the booking page opens in a new tab.

## 3. Add the final website URL

After GitHub Pages gives you the published address, open `config.js` and add it:

```javascript
const TASKCORE_WEBSITE_URL = "https://mrjgames.github.io/taskcore-booking-page/";
```

Use the exact address shown by GitHub Pages, including `https://`.

## 4. Generate the real QR code

Install Python from [python.org](https://www.python.org/downloads/) if it is not already installed. During installation, select **Add Python to PATH**. Then open PowerShell in this folder and run:

```powershell
py -m pip install "qrcode[pil]"
py generate_qr.py
```

The script reads the final address from `config.js` and creates a high-resolution PNG plus a scalable SVG in `assets/qr/`. It will stop with a clear message if the website URL is blank or invalid. Run it again whenever the published address changes.

## 5. Create a GitHub repository

This project already has a local Git repository and an initial `main` branch. Nothing has been sent to GitHub.

1. Sign in at [github.com](https://github.com/).
2. Select the **+** menu near the upper-right corner, then **New repository**.
3. Enter `taskcore-booking-page` as the repository name.
4. Choose **Public** so GitHub Pages can host it free.
5. Leave **Add a README**, **Add .gitignore**, and **Choose a license** turned off because the project already contains its own files.
6. Select **Create repository**.
7. Keep the new repository page open. GitHub will display the repository address needed for the next step.

When ready to connect and upload the local project, open PowerShell in this project folder and run the commands GitHub shows under **…or push an existing repository from the command line**. They will look like this:

```powershell
git remote add origin YOUR_GITHUB_REPOSITORY_ADDRESS
git push -u origin main
```

Replace `YOUR_GITHUB_REPOSITORY_ADDRESS` with the exact address displayed by GitHub. Do not run these commands until you are ready to upload publicly.

## 6. Publish free with GitHub Pages

1. After the files have been pushed, open the repository's **Settings**.
2. Select **Pages** in the left menu.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Choose the `main` branch and `/ (root)` folder, then select **Save**.
5. Wait a few minutes and refresh the Pages settings. GitHub will show the published address.
6. Put that address in `TASKCORE_WEBSITE_URL`, generate the QR code, then commit and push the updated `config.js` and QR image.

Nothing in this project is published automatically.

## 7. Test the Call button

Open the site on a phone and tap **Call Now**. Confirm the phone opens its calling screen with `(442) 822-5357`. Cancel before placing the call if this is only a test. Desktop computers may ask which calling app to use.

## 8. Test the Text button

Open the site on a phone and tap **Text Jay**. Confirm a new message opens to `(442) 822-5357` with the prepared TaskCore message. Do not send it unless desired.

## 9. Test the booking button

Leave `TASKCORE_BOOKING_URL` blank and confirm **Book Appointment** moves to the quote form. If a real booking link is added later, reload the page and confirm the button opens that booking page in a new tab.

## 10. Test the QR code before printing

Open `assets/qr/taskcore-website-qr.png` on a different screen or print one sample. Scan it with at least one phone camera. Confirm the preview shows the exact GitHub Pages address and opens the live TaskCore page. Test again after any URL change and before ordering business cards.

## Privacy-friendly local click counts

The page stores counts for Book, Call, and Text button clicks only in that visitor's browser using `localStorage`. These counts never leave the device, and they do **not** let TaskCore or the site owner see customer activity. Actual appointment tracking happens through Google Form responses or Google Calendar appointments.

## Quote requests and photos

The quote form prepares a formatted request with **Text Request** and **Copy Request** actions. Text Request opens a message to `(442) 822-5357`; the customer must send it before TaskCore receives anything. Selected photos are previewed temporarily using browser memory and must be attached manually after the messaging app opens. They are never stored or uploaded by the website.

## Install the TaskCore app

The site includes `manifest.json` and `service-worker.js`. On supported browsers, an **Install App** button appears after the browser confirms the site can be installed. On iPhone or iPad, open the published site in Safari, tap **Share**, then **Add to Home Screen**. The main static page remains available after it has been visited once, even when the device is offline.

## Important checks before sharing

- Confirm both URLs in `config.js` are the intended real links.
- Test on a phone and a computer.
- Scan the QR code from the final published page.
- Keep Jay's phone number as `(442) 822-5357` / `+14428225357` in all links.
- Keep the contact email as `Taskcorepros@gmail.com`.
