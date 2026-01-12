// ==UserScript==
// @name         Citi Merchant Offers - Accept All with Progress, Timer & Smart Filtering
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  Automatically accepts all merchant offers on Citibank's website while strictly excluding already enrolled offers and tracking failed attempts.
// @author       Syed Ashrafulla <syed@ashraful.la>
// @author       Gemini <gemini@google.com>
// @match        https://online.citi.com/US/ag/products-offers/merchantoffers*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const LOG_PREFIX = '[CitiOfferScript] ';
    const ENROLL_SELECTOR = 'button[aria-label^="Enroll in Offer for"]';
    const CLOSE_SELECTOR = 'button.modal-close-btn, button[aria-label="Close"], button[title="Close"]';
    const ENROLLED_INDICATOR = 'div[aria-label^="Enrolled for"]';
    const ERROR_TEXT = "Unable to enroll merchant offer. Please try again.";

    let totalOffers = 0;
    let completedOffers = 0;
    let isRunning = true;
    let startTime = null;
    let timerInterval = null;
    let phase = 'Initializing';

    // Track offers attempted in this session to prevent infinite loops on failures
    const attemptedMerchants = new Set();

    function log(msg) {
        console.log(LOG_PREFIX + msg);
    }

    function formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return (minutes < 10 ? '0' : '') + minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
    }

    function createOverlay() {
        const div = document.createElement('div');
        div.id = 'citi-offer-overlay';
        div.style.position = 'fixed';
        div.style.top = '20px';
        div.style.right = '20px';
        div.style.padding = '15px 20px';
        div.style.backgroundColor = '#056DAE';
        div.style.color = 'white';
        div.style.zIndex = '100000';
        div.style.borderRadius = '8px';
        div.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        div.style.fontFamily = 'Arial, sans-serif';
        div.style.minWidth = '220px';

        document.body.appendChild(div);
        startTime = Date.now();
        timerInterval = setInterval(updateUI, 1000);
        updateUI();
    }

    function updateUI() {
        const overlay = document.getElementById('citi-offer-overlay');
        if (!overlay) return;

        const remaining = totalOffers - completedOffers;
        const elapsed = startTime ? formatTime(Date.now() - startTime) : '00:00';
        overlay.innerHTML = '';

        const title = document.createElement('div');
        title.style.fontWeight = 'bold';
        title.style.marginBottom = '8px';
        title.style.borderBottom = '1px solid rgba(255,255,255,0.3)';
        title.style.paddingBottom = '5px';
        title.innerText = 'Citi Offer Automator';
        overlay.appendChild(title);

        if (phase === 'Scanning') {
            const scanText = document.createElement('div');
            scanText.style.margin = '10px 0';
            scanText.innerText = 'Scanning for un-enrolled offers... Found: ' + totalOffers;
            overlay.appendChild(scanText);
        } else if (remaining <= 0 && totalOffers > 0 && phase === 'Processing') {
            const success = document.createElement('div');
            success.style.color = '#90EE90';
            success.style.fontWeight = 'bold';
            success.innerText = '✅ Process Complete!';
            overlay.appendChild(success);
            clearInterval(timerInterval);
        } else {
            const stats = document.createElement('div');
            stats.style.fontSize = '20px';
            stats.style.fontWeight = 'bold';
            stats.style.margin = '5px 0';
            stats.innerText = completedOffers + ' / ' + totalOffers;
            overlay.appendChild(stats);

            const timeDisplay = document.createElement('div');
            timeDisplay.style.fontSize = '14px';
            timeDisplay.style.marginBottom = '5px';
            timeDisplay.innerText = 'Elapsed: ' + elapsed;
            overlay.appendChild(timeDisplay);

            const remText = document.createElement('div');
            remText.style.fontSize = '12px';
            remText.style.opacity = '0.9';
            remText.innerText = remaining + ' remaining...';
            overlay.appendChild(remText);
        }

        if (isRunning && (phase === 'Scanning' || remaining > 0 || totalOffers === 0)) {
            const stopBtn = document.createElement('button');
            stopBtn.innerText = 'Stop Script';
            stopBtn.style.marginTop = '15px';
            stopBtn.style.width = '100%';
            stopBtn.style.padding = '5px';
            stopBtn.style.cursor = 'pointer';
            stopBtn.style.backgroundColor = '#fff';
            stopBtn.style.border = 'none';
            stopBtn.style.borderRadius = '4px';
            stopBtn.style.color = '#056DAE';
            stopBtn.style.fontWeight = 'bold';

            stopBtn.onclick = function() {
                isRunning = false;
                clearInterval(timerInterval);
                overlay.innerHTML = '<div style="font-weight: bold;">Stopped.</div>';
                setTimeout(function() { overlay.remove(); }, 2000);
            };
            overlay.appendChild(stopBtn);
        }
    }

    function getEligibleOffers() {
        return Array.from(document.querySelectorAll(ENROLL_SELECTOR)).filter(button => {
            const label = button.getAttribute('aria-label') || '';
            const tile = button.closest('app-mo-offer-tile');

            // Filter out:
            // 1. Offers already processed in this loop (to handle failure cases)
            // 2. Offers already marked as enrolled by the page
            const isAttempted = attemptedMerchants.has(label);
            const isAlreadyEnrolled = tile ? !!tile.querySelector(ENROLLED_INDICATOR) : false;

            return !isAttempted && !isAlreadyEnrolled;
        });
    }

    function scrollAndLoad(lastCount, stability) {
        if (!isRunning) return;

        window.scrollTo(0, document.body.scrollHeight);

        setTimeout(() => {
            window.scrollBy(0, -200);
            setTimeout(() => {
                window.scrollTo(0, document.body.scrollHeight);
            }, 200);
        }, 500);

        setTimeout(() => {
            const currentCount = getEligibleOffers().length;
            totalOffers = currentCount;
            updateUI();

            if (currentCount > lastCount) {
                log('Found ' + currentCount + ' new eligible offers. Continuing scroll...');
                scrollAndLoad(currentCount, 0);
            } else if (stability < 6) {
                log('Checking stability ' + (stability + 1) + '/6...');
                scrollAndLoad(currentCount, stability + 1);
            } else {
                log('Scan complete. ' + currentCount + ' offers to accept.');
                phase = 'Processing';
                processNextOffer();
            }
        }, 3000);
    }

    function processNextOffer() {
        if (!isRunning) return;

        const enrollButtons = getEligibleOffers();

        if (enrollButtons.length === 0) {
            log('No more offers found.');
            completedOffers = totalOffers;
            updateUI();
            return;
        }

        const button = enrollButtons[0];
        const label = button.getAttribute('aria-label');

        log('Enrolling next offer: ' + label);
        attemptedMerchants.add(label); // Mark as attempted immediately
        button.click();

        waitForPopup();
    }

    function waitForPopup() {
        if (!isRunning) return;

        let attempts = 0;
        const checkInterval = setInterval(function() {
            const closeBtn = document.querySelector(CLOSE_SELECTOR);
            attempts++;

            if (closeBtn) {
                const pageText = document.body.innerText;
                if (pageText.includes(ERROR_TEXT)) {
                    log('Error popup found. Skipping this merchant for this session.');
                } else {
                    log('Enrollment successful.');
                }

                clearInterval(checkInterval);
                closeBtn.click();
                completedOffers++;
                updateUI();
                waitForPopupToFade();
            } else if (attempts > 20) {
                log('Popup did not appear. Moving on to next to avoid stall.');
                clearInterval(checkInterval);
                completedOffers++;
                updateUI();
                setTimeout(processNextOffer, 500);
            }
        }, 500);
    }

    function waitForPopupToFade() {
        const checkInterval = setInterval(function() {
            const closeBtn = document.querySelector(CLOSE_SELECTOR);
            if (!closeBtn) {
                clearInterval(checkInterval);
                setTimeout(processNextOffer, 500);
            }
        }, 500);
    }

    log('Script initialized.');

    const initInterval = setInterval(function() {
        if (document.readyState === 'complete') {
            const initialCheck = document.querySelectorAll(ENROLL_SELECTOR);
            if (initialCheck.length > 0) {
                clearInterval(initInterval);
                log('Page stable. Starting filtered scan...');
                phase = 'Scanning';
                createOverlay();
                scrollAndLoad(0, 0);
            }
        }
    }, 1000);
})();
