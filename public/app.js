const CATEGORY_ICONS = {
  Books: '▤',
  Furniture: '⌂',
  Electronics: '⌁',
  Bikes: '↗',
  Home: '✳',
  Other: '○',
};

const nameInput = document.querySelector('#student-name');
const listingForm = document.querySelector('#listing-form');
const listingsElement = document.querySelector('#listings');
const noticeElement = document.querySelector('#notice');
const counts = {
  available: document.querySelector('#available-count'),
  claimed: document.querySelector('#claimed-count'),
  sold: document.querySelector('#sold-count'),
};
let items = [];
let noticeTimeout;
let fetchFailed = false;

function showNotice(message, isError = false) {
  noticeElement.textContent = message;
  noticeElement.classList.toggle('notice-error', isError);
  noticeElement.hidden = false;
  clearTimeout(noticeTimeout);
  noticeTimeout = setTimeout(() => {
    noticeElement.hidden = true;
  }, 4500);
}

function currentName() {
  return nameInput.value.trim();
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('The server returned an invalid response.');
  }
  if (!response.ok) {
    throw new Error(result.error || 'The marketplace could not complete that request.');
  }
  return result;
}

function appendText(parent, tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  element.textContent = text;
  parent.append(element);
  return element;
}

function makeButton(label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

async function performAction(button, action, successMessage) {
  button.disabled = true;
  try {
    await action();
    showNotice(successMessage);
    await loadItems();
  } catch (error) {
    showNotice(error.message, true);
    await loadItems();
  }
}

function formatTimeRemaining(expiresAt) {
  const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  return `${seconds}s left to confirm pickup`;
}

function makeListingCard(item) {
  const card = document.createElement('article');
  card.className = `listing-card listing-${item.state}`;

  const top = document.createElement('div');
  top.className = 'card-top';
  const icon = appendText(top, 'span', 'category-icon', CATEGORY_ICONS[item.category] || CATEGORY_ICONS.Other);
  icon.setAttribute('aria-hidden', 'true');
  const category = appendText(top, 'span', 'category-label', item.category);
  category.setAttribute('aria-label', `Category: ${item.category}`);
  card.append(top);

  appendText(card, 'h3', 'listing-title', item.title);
  appendText(card, 'p', 'listing-description', item.description || 'Ready for a new home on campus.');

  const seller = document.createElement('p');
  seller.className = 'seller-line';
  seller.append(document.createTextNode('From '));
  appendText(seller, 'strong', '', item.sellerName);
  card.append(seller);

  const footer = document.createElement('div');
  footer.className = 'card-footer';
  const status = document.createElement('span');
  status.className = `status-pill status-${item.state}`;

  if (item.state === 'available') {
    status.textContent = 'Available';
  } else if (item.state === 'claimed') {
    status.textContent = `Reserved by ${item.claim.buyerName}`;
  } else {
    status.textContent = item.soldReason === 'handoff' ? 'Handoff complete' : 'Sold by seller';
  }
  footer.append(status);

  const name = currentName();
  if (item.state === 'available') {
    const claimButton = makeButton('Claim item', 'button button-accent button-small', (event) => {
      if (name.length < 2) {
        showNotice('Add your name above before claiming an item.', true);
        return;
      }
      void performAction(
        event.currentTarget,
        () => requestJson(`/api/items/${item.id}/claim`, {
          method: 'POST',
          body: JSON.stringify({ buyerName: name }),
        }),
        `You’ve reserved “${item.title}”. Confirm the handoff within 60 seconds.`,
      );
    });
    claimButton.disabled = name.length < 2 || name.toLowerCase() === item.sellerName.toLowerCase();
    claimButton.title = name.toLowerCase() === item.sellerName.toLowerCase()
      ? 'You cannot claim your own listing.'
      : '';
    footer.append(claimButton);
  } else if (item.state === 'claimed') {
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    if (name.toLowerCase() === item.claim.buyerName.toLowerCase()) {
      const confirmButton = makeButton('Confirm pickup', 'button button-accent button-small', (event) => {
        void performAction(
          event.currentTarget,
          () => requestJson(`/api/items/${item.id}/confirm`, {
            method: 'POST',
            body: JSON.stringify({ buyerName: name }),
          }),
          'Pickup confirmed. This listing is complete.',
        );
      });
      actions.append(confirmButton);
    } else {
      appendText(actions, 'span', 'expiry-note', formatTimeRemaining(item.claim.expiresAt));
    }
    if (name.toLowerCase() === item.sellerName.toLowerCase()) {
      actions.append(makeSellerButton(item, name));
    }
    footer.append(actions);
  } else if (name.toLowerCase() === item.sellerName.toLowerCase()) {
    appendText(footer, 'span', 'seller-complete-note', 'Your listing is complete');
  }

  if (item.state === 'available' && name.toLowerCase() === item.sellerName.toLowerCase()) {
    footer.append(makeSellerButton(item, name));
  }
  card.append(footer);
  return card;
}

function makeSellerButton(item, sellerName) {
  return makeButton('Mark as sold', 'button button-quiet button-small', (event) => {
    if (!window.confirm(`Mark “${item.title}” as sold outside the marketplace?`)) {
      return;
    }
    void performAction(
      event.currentTarget,
      () => requestJson(`/api/items/${item.id}/sold`, {
        method: 'POST',
        body: JSON.stringify({ sellerName }),
      }),
      'Listing marked sold and removed from the available items.',
    );
  });
}

function renderItems() {
  listingsElement.replaceChildren();
  counts.available.textContent = String(items.filter((item) => item.state === 'available').length);
  counts.claimed.textContent = String(items.filter((item) => item.state === 'claimed').length);
  counts.sold.textContent = String(items.filter((item) => item.state === 'sold').length);

  if (items.length === 0) {
    appendText(listingsElement, 'p', 'empty-state', 'No listings just yet. Be the first to pass something on.');
    return;
  }

  for (const item of items) {
    listingsElement.append(makeListingCard(item));
  }
}

async function loadItems() {
  const result = await requestJson('/api/items');
  items = result.items;
  renderItems();
  if (fetchFailed) {
    fetchFailed = false;
    showNotice('Connection restored. The marketplace is up to date.');
  }
}

nameInput.addEventListener('input', renderItems);

listingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const sellerName = currentName();
  if (sellerName.length < 2 || sellerName.length > 40) {
    showNotice('Enter your name above (2–40 characters) before posting.', true);
    nameInput.focus();
    return;
  }

  const formData = new FormData(listingForm);
  const submitButton = listingForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    await requestJson('/api/items', {
      method: 'POST',
      body: JSON.stringify({
        title: formData.get('title'),
        category: formData.get('category'),
        description: formData.get('description'),
        sellerName,
      }),
    });
    listingForm.reset();
    showNotice('Your listing is live. Thanks for passing it on!');
    await loadItems();
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

async function refreshListings() {
  try {
    await loadItems();
  } catch (error) {
    if (!fetchFailed) {
      showNotice(error.message, true);
    }
    fetchFailed = true;
  }
}

void refreshListings();
setInterval(() => {
  void refreshListings();
}, 1000);
