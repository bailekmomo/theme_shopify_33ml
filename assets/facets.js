import { sectionRenderer } from '@theme/section-renderer';
import { Component } from '@theme/component';
import { FilterUpdateEvent, ThemeEvents } from '@theme/events';
import { debounce, formatMoney, startViewTransition } from '@theme/utilities';

/**
 * Search query parameter.
 * @type {string}
 */
const SEARCH_QUERY = 'q';

/**
 * Handles the main facets form functionality
 *
 * @typedef {Object} FacetsFormRefs
 * @property {HTMLFormElement} facetsForm - The main facets form element
 * @property {HTMLElement | undefined} facetStatus - The facet status element
 *
 * @extends {Component<FacetsFormRefs>}
 */
class FacetsFormComponent extends Component {
  requiredRefs = ['facetsForm'];

  /**
   * Creates URL parameters from form data
   * @param {FormData} [formData] - Optional form data to use instead of the main form
   * @returns {URLSearchParams} The processed URL parameters
   */
  createURLParameters(formData = new FormData(this.refs.facetsForm)) {
    let newParameters = new URLSearchParams(/** @type any */ (formData));

    if (newParameters.get('filter.v.price.gte') === '') newParameters.delete('filter.v.price.gte');
    if (newParameters.get('filter.v.price.lte') === '') newParameters.delete('filter.v.price.lte');

    newParameters.delete('page');

    const searchQuery = this.#getSearchQuery();
    if (searchQuery) newParameters.set(SEARCH_QUERY, searchQuery);

    return newParameters;
  }

  /**
   * Gets the search query parameter from the current URL
   * @returns {string} The search query
   */
  #getSearchQuery() {
    const url = new URL(window.location.href);
    return url.searchParams.get(SEARCH_QUERY) ?? '';
  }

  get sectionId() {
    const id = this.getAttribute('section-id');
    if (!id) throw new Error('Section ID is required');
    return id;
  }

  /**
   * Updates the URL hash with current filter parameters
   */
  #updateURLHash() {
    const url = new URL(window.location.href);
    const urlParameters = this.createURLParameters();

    url.search = '';
    for (const [param, value] of urlParameters.entries()) {
      url.searchParams.append(param, value);
    }

    history.pushState({ urlParameters: urlParameters.toString() }, '', url.toString());
  }

  /**
   * Updates filters and renders the section
   */
  updateFilters = () => {
    this.#updateURLHash();
    this.dispatchEvent(new FilterUpdateEvent(this.createURLParameters()));
    this.#updateSection();
  };

  /**
   * Updates the section
   */
  #updateSection() {
    const viewTransition = !this.closest('dialog');

    if (viewTransition) {
      startViewTransition(() => sectionRenderer.renderSection(this.sectionId), ['product-grid']);
    } else {
      sectionRenderer.renderSection(this.sectionId);
    }
  }

  /**
   * Updates filters based on a provided URL
   * @param {string} url - The URL to update filters with
   */
  updateFiltersByURL(url) {
    history.pushState('', '', url);
    this.dispatchEvent(new FilterUpdateEvent(this.createURLParameters()));
    this.#updateSection();
  }
}

if (!customElements.get('facets-form-component')) {
  customElements.define('facets-form-component', FacetsFormComponent);
}

/**
 * @typedef {Object} FacetInputsRefs
 * @property {HTMLInputElement[]} facetInputs - The facet input elements
 */

/**
 * Handles individual facet input functionality
 * @extends {Component<FacetInputsRefs>}
 */
class FacetInputsComponent extends Component {
  get sectionId() {
    const id = this.closest('.shopify-section')?.id;
    if (!id) throw new Error('FacetInputs component must be a child of a section');
    return id;
  }

  /**
   * Updates filters and the selected facet summary
   */
  updateFilters() {
    const facetsForm = this.closest('facets-form-component');

    if (!(facetsForm instanceof FacetsFormComponent)) return;

    facetsForm.updateFilters();
    this.#updateSelectedFacetSummary();
  }

  /**
   * Handles keydown events for the facets form
   * @param {KeyboardEvent} event - The keydown event
   */
  handleKeyDown(event) {
    if (!(event.target instanceof HTMLElement)) return;
    const closestInput = event.target.querySelector('input');

    if (!(closestInput instanceof HTMLInputElement)) return;

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      closestInput.checked = !closestInput.checked;
      this.updateFilters();
    }
  }

  /**
   * Handles mouseover events on facet labels
   * @param {MouseEvent} event - The mouseover event
   */
  prefetchPage = debounce((event) => {
    if (!(event.target instanceof HTMLElement)) return;

    const form = this.closest('form');
    if (!form) return;

    const formData = new FormData(form);
    const inputElement = event.target.querySelector('input');

    if (!(inputElement instanceof HTMLInputElement)) return;

    if (!inputElement.checked) formData.append(inputElement.name, inputElement.value);

    const facetsForm = this.closest('facets-form-component');
    if (!(facetsForm instanceof FacetsFormComponent)) return;

    const urlParameters = facetsForm.createURLParameters(formData);

    const url = new URL(window.location.pathname, window.location.origin);

    for (const [key, value] of urlParameters) url.searchParams.append(key, value);

    if (inputElement.checked) url.searchParams.delete(inputElement.name, inputElement.value);

    sectionRenderer.getSectionHTML(this.sectionId, true, url);
  }, 200);

  cancelPrefetchPage = () => this.prefetchPage.cancel();

  /**
   * Updates the selected facet summary
   */
  #updateSelectedFacetSummary() {
    if (!this.refs.facetInputs) return;

    const checkedInputElements = this.refs.facetInputs.filter((input) => input.checked);
    const details = this.closest('details');
    const statusComponent = details?.querySelector('facet-status-component');

    if (!(statusComponent instanceof FacetStatusComponent)) return;

    statusComponent.updateListSummary(checkedInputElements);
  }
}

if (!customElements.get('facet-inputs-component')) {
  customElements.define('facet-inputs-component', FacetInputsComponent);
}

/**
 * Filters products client-side based on custom metafield filters
 */
function filterProductsByCustomMetafields() {
  const productGrid = document.querySelector('.product-grid');
  if (!productGrid) return;

  const productItems = Array.from(productGrid.querySelectorAll('.product-grid__item'));
  if (productItems.length === 0) return;

  // Get all active custom filters
  const urlParams = new URLSearchParams(window.location.search);
  const intensityMax = urlParams.get('filter.intensity_max');
  const activeOlfactiveNotes = urlParams.getAll('filter.olfactive_note');

  // Filter products
  productItems.forEach((item) => {
    const productCard = item.querySelector('product-card');
    if (!(productCard instanceof HTMLElement)) {
      if (item instanceof HTMLElement) {
        item.style.display = 'none';
      }
      return;
    }

    let shouldShow = true;

    // Check intensity filter (maximum value)
    if (intensityMax) {
      const intensity = productCard.dataset.intensity;
      if (!intensity) {
        shouldShow = false;
      } else {
        const intensityValue = parseInt(intensity, 10);
        const maxValue = parseInt(intensityMax, 10);
        if (isNaN(intensityValue) || isNaN(maxValue) || intensityValue > maxValue) {
          shouldShow = false;
        }
      }
    }

    // Check olfactive notes filter
    if (activeOlfactiveNotes.length > 0 && shouldShow) {
      const olfactiveNotes = productCard.dataset.olfactiveNotes;
      if (!olfactiveNotes) {
        shouldShow = false;
      } else {
        const notesArray = olfactiveNotes.split(',').map((note) => note.trim());
        const hasMatchingNote = activeOlfactiveNotes.some((activeNote) =>
          notesArray.some((note) => note === activeNote)
        );
        if (!hasMatchingNote) {
          shouldShow = false;
        }
      }
    }

    if (item instanceof HTMLElement) {
      item.style.display = shouldShow ? '' : 'none';
    }
  });
}

/**
 * Updates URL with custom filter parameters
 * @param {string} filterType - The filter type ('intensity' | 'olfactive_notes')
 */
function updateCustomFilterURL(filterType) {
  const url = new URL(window.location.href);
  const facetInputs = document.querySelector(`facet-inputs-component[data-filter-type="${filterType}"]`);
  
  if (!facetInputs) return;

  // Remove existing filter parameters for this filter type
  if (filterType === 'intensity') {
    url.searchParams.delete('filter.intensity_max');
    
    // Get slider value
    const slider = facetInputs.querySelector('input[type="range"]');
    if (slider instanceof HTMLInputElement) {
      const maxIntensity = parseInt(slider.value, 10);
      const sliderMax = parseInt(slider.max, 10);
      // Only add to URL if not at maximum (meaning all products are shown)
      if (maxIntensity < sliderMax) {
        url.searchParams.set('filter.intensity_max', slider.value);
      }
    }
  } else if (filterType === 'olfactive_notes') {
    url.searchParams.delete('filter.olfactive_note');
    
    // Add checked filter values
    const checkedInputs = facetInputs.querySelectorAll('input[type="checkbox"]:checked');
    checkedInputs.forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      url.searchParams.append('filter.olfactive_note', input.value);
    });
  }

  history.pushState({ urlParameters: url.searchParams.toString() }, '', url.toString());
}

/**
 * Updates facet status display
 * @param {HTMLElement} facetInputs - The facet inputs component element
 */
function updateCustomFacetStatus(facetInputs) {
  if (!(facetInputs instanceof HTMLElement)) return;
  
  const filterType = facetInputs.dataset.filterType;
  const details = facetInputs.closest('details');
  const statusComponent = details?.querySelector('facet-status-component');

  if (!(statusComponent instanceof FacetStatusComponent)) return;

  if (filterType === 'intensity') {
    // Update intensity filter status
    const slider = facetInputs.querySelector('input[type="range"]');
    if (slider instanceof HTMLInputElement) {
      const maxIntensity = parseInt(slider.value, 10);
      const sliderMax = parseInt(slider.max, 10);
      const statusSpan = statusComponent.querySelector('span[ref="facetStatus"]');
      if (statusSpan instanceof HTMLElement) {
        if (maxIntensity < sliderMax) {
          statusSpan.textContent = `≤ ${maxIntensity}`;
          statusSpan.classList.add('bubble', 'facets__bubble');
        } else {
          statusSpan.textContent = '';
          statusSpan.classList.remove('bubble', 'facets__bubble');
        }
      }
      
      // Update value display
      const valueDisplay = facetInputs.querySelector('.intensity-filter__value-text');
      if (valueDisplay instanceof HTMLElement) {
        if (maxIntensity < sliderMax) {
          valueDisplay.textContent = `≤ ${maxIntensity}`;
        } else {
          valueDisplay.textContent = 'Tous';
        }
      }
    }
  } else if (filterType === 'olfactive_notes') {
    // Update olfactive notes filter status
    const checkedInputs = facetInputs.querySelectorAll('input[type="checkbox"]:checked');
    const checkedElements = Array.from(checkedInputs).filter((input) => input instanceof HTMLInputElement);
    statusComponent.updateListSummary(checkedElements);
  }
}

// Extend FacetInputsComponent to handle custom filters
const originalUpdateFilters = FacetInputsComponent.prototype.updateFilters;
FacetInputsComponent.prototype.updateFilters = function () {
  const filterType = this.dataset.filterType;
  if (filterType === 'intensity' || filterType === 'olfactive_notes') {
    updateCustomFilterURL(filterType);
    filterProductsByCustomMetafields();
    updateCustomFacetStatus(this);
  } else {
    originalUpdateFilters.call(this);
  }
};

// Register custom filter handlers
document.addEventListener('DOMContentLoaded', () => {
  // Handle custom filter inputs (including slider)
  document.addEventListener('change', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.classList.contains('custom-filter-input')) {
      const facetInputs = event.target.closest('facet-inputs-component');
      if (facetInputs instanceof HTMLElement) {
        const filterType = facetInputs.dataset.filterType;
        if (filterType === 'intensity' || filterType === 'olfactive_notes') {
          updateCustomFilterURL(filterType);
          filterProductsByCustomMetafields();
          updateCustomFacetStatus(facetInputs);
        }
      }
    }
  });

  // Handle slider input for real-time updates
  document.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type === 'range' && event.target.classList.contains('custom-filter-input')) {
      const facetInputs = event.target.closest('facet-inputs-component');
      if (facetInputs instanceof HTMLElement) {
        const filterType = facetInputs.dataset.filterType;
        if (filterType === 'intensity') {
          // Update value display in real-time
          updateCustomFacetStatus(facetInputs);
        }
      }
    }
  });

  // Handle clear custom filter buttons
  document.addEventListener('click', (event) => {
    if (event.target instanceof HTMLButtonElement && event.target.classList.contains('clear-filter')) {
      const filterType = event.target.dataset.filterType;
      if (filterType === 'intensity' || filterType === 'olfactive_notes') {
        const facetInputs = event.target.closest('facet-inputs-component');
        if (facetInputs instanceof HTMLElement) {
          event.preventDefault();
          
          // Uncheck all inputs
          const inputs = facetInputs.querySelectorAll('input[type="checkbox"]');
          inputs.forEach((input) => {
            if (input instanceof HTMLInputElement) {
              input.checked = false;
            }
          });

          // Update URL
          const url = new URL(window.location.href);
          if (filterType === 'intensity') {
            url.searchParams.delete('filter.intensity_max');
            // Reset slider to max value
            const slider = facetInputs.querySelector('input[type="range"]');
            if (slider instanceof HTMLInputElement) {
              slider.value = slider.max;
            }
          } else if (filterType === 'olfactive_notes') {
            url.searchParams.delete('filter.olfactive_note');
          }
          history.pushState({ urlParameters: url.searchParams.toString() }, '', url.toString());

          // Filter products and update status
          filterProductsByCustomMetafields();
          updateCustomFacetStatus(facetInputs);
        }
      }
    }
  });

  // Apply filters on page load
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('filter.intensity_max') || urlParams.has('filter.olfactive_note')) {
    filterProductsByCustomMetafields();
    
    // Update intensity slider position if filter is active
    if (urlParams.has('filter.intensity_max')) {
      const intensityMax = urlParams.get('filter.intensity_max');
      if (intensityMax) {
        const intensityFilters = document.querySelectorAll('facet-inputs-component[data-filter-type="intensity"]');
        intensityFilters.forEach((facetInputs) => {
          if (facetInputs instanceof HTMLElement) {
            const slider = facetInputs.querySelector('input[type="range"]');
            if (slider instanceof HTMLInputElement) {
              slider.value = intensityMax;
              updateCustomFacetStatus(facetInputs);
            }
          }
        });
      }
    }
  }
});

/**
 * @typedef {Object} PriceFacetRefs
 * @property {HTMLInputElement} minInput - The minimum price input
 * @property {HTMLInputElement} maxInput - The maximum price input
 */

/**
 * Handles price facet functionality
 * @extends {Component<PriceFacetRefs>}
 */
class PriceFacetComponent extends Component {
  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('keydown', this.#onKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.#onKeyDown);
  }

  /**
   * Handles keydown events to restrict input to valid characters
   * @param {KeyboardEvent} event - The keydown event
   */
  #onKeyDown = (event) => {
    if (event.metaKey) return;

    const pattern = /[0-9]|\.|,|'| |Tab|Backspace|Enter|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Delete|Escape/;
    if (!event.key.match(pattern)) event.preventDefault();
  };

  /**
   * Updates price filter and results
   */
  updatePriceFilterAndResults() {
    const { minInput, maxInput } = this.refs;

    this.#adjustToValidValues(minInput);
    this.#adjustToValidValues(maxInput);

    const facetsForm = this.closest('facets-form-component');
    if (!(facetsForm instanceof FacetsFormComponent)) return;

    facetsForm.updateFilters();
    this.#setMinAndMaxValues();
    this.#updateSummary();
  }

  /**
   * Adjusts input values to be within valid range
   * @param {HTMLInputElement} input - The input element to adjust
   */
  #adjustToValidValues(input) {
    if (input.value.trim() === '') return;

    const value = Number(input.value);
    const min = Number(formatMoney(input.getAttribute('data-min') ?? ''));
    const max = Number(formatMoney(input.getAttribute('data-max') ?? ''));

    if (value < min) input.value = min.toString();
    if (value > max) input.value = max.toString();
  }

  /**
   * Sets min and max values for the inputs
   */
  #setMinAndMaxValues() {
    const { minInput, maxInput } = this.refs;

    if (maxInput.value) minInput.setAttribute('data-max', maxInput.value);
    if (minInput.value) maxInput.setAttribute('data-min', minInput.value);
    if (minInput.value === '') maxInput.setAttribute('data-min', '0');
    if (maxInput.value === '') minInput.setAttribute('data-max', maxInput.getAttribute('data-max') ?? '');
  }

  /**
   * Updates the price summary
   */
  #updateSummary() {
    const { minInput, maxInput } = this.refs;
    const details = this.closest('details');
    const statusComponent = details?.querySelector('facet-status-component');

    if (!(statusComponent instanceof FacetStatusComponent)) return;

    statusComponent?.updatePriceSummary(minInput, maxInput);
  }
}

if (!customElements.get('price-facet-component')) {
  customElements.define('price-facet-component', PriceFacetComponent);
}

/**
 * Handles clearing of facet filters
 * @extends {Component}
 */
class FacetClearComponent extends Component {
  requiredRefs = ['clearButton'];

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('keyup', this.#handleKeyUp);
    document.addEventListener(ThemeEvents.FilterUpdate, this.#handleFilterUpdate);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(ThemeEvents.FilterUpdate, this.#handleFilterUpdate);
  }

  /**
   * Clears the filter
   * @param {Event} event - The click event
   */
  clearFilter(event) {
    if (!(event.target instanceof HTMLElement)) return;

    if (event instanceof KeyboardEvent) {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
    }

    const container = event.target.closest('facet-inputs-component, price-facet-component');
    container?.querySelectorAll('[type="checkbox"]:checked, input').forEach((input) => {
      if (input instanceof HTMLInputElement) {
        input.checked = false;
        input.value = '';
      }
    });

    const details = event.target.closest('details');
    const statusComponent = details?.querySelector('facet-status-component');

    if (!(statusComponent instanceof FacetStatusComponent)) return;

    statusComponent.clearSummary();

    const facetsForm = this.closest('facets-form-component');
    if (!(facetsForm instanceof FacetsFormComponent)) return;

    facetsForm.updateFilters();
  }

  /**
   * Handles keyup events
   * @param {KeyboardEvent} event - The keyup event
   */
  #handleKeyUp = (event) => {
    if (event.metaKey) return;
    if (event.key === 'Enter') this.clearFilter(event);
  };

  /**
   * Toggle clear button visibility when filters are applied. Happens before the
   * Section Rendering Request resolves.
   *
   * @param {FilterUpdateEvent} event
   */
  #handleFilterUpdate = (event) => {
    const { clearButton } = this.refs;
    if (clearButton instanceof Element) {
      clearButton.classList.toggle('facets__clear--active', event.shouldShowClearAll());
    }
  };
}

if (!customElements.get('facet-clear-component')) {
  customElements.define('facet-clear-component', FacetClearComponent);
}

/**
 * @typedef {Object} FacetRemoveComponentRefs
 * @property {HTMLInputElement | undefined} clearButton - The button to clear filters
 */

/**
 * Handles removal of individual facet filters
 * @extends {Component<FacetRemoveComponentRefs>}
 */
class FacetRemoveComponent extends Component {
  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(ThemeEvents.FilterUpdate, this.#handleFilterUpdate);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(ThemeEvents.FilterUpdate, this.#handleFilterUpdate);
  }

  /**
   * Removes the filter
   * @param {Object} data - The data object
   * @param {string} data.form - The form to remove the filter from
   * @param {Event} event - The click event
   */
  removeFilter({ form }, event) {
    if (event instanceof KeyboardEvent) {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
    }

    const url = this.dataset.url;
    if (!url) return;

    const facetsForm = form ? document.getElementById(form) : this.closest('facets-form-component');

    if (!(facetsForm instanceof FacetsFormComponent)) return;

    facetsForm.updateFiltersByURL(url);
  }

  /**
   * Toggle clear button visibility when filters are applied. Happens before the
   * Section Rendering Request resolves.
   *
   * @param {FilterUpdateEvent} event
   */
  #handleFilterUpdate = (event) => {
    const { clearButton } = this.refs;
    if (clearButton instanceof Element) {
      clearButton.classList.toggle('active', event.shouldShowClearAll());
    }
  };
}

if (!customElements.get('facet-remove-component')) {
  customElements.define('facet-remove-component', FacetRemoveComponent);
}

/**
 * Handles sorting filter functionality
 *
 * @typedef {Object} SortingFilterRefs
 * @property {HTMLDetailsElement} details - The details element
 * @property {HTMLElement} summary - The summary element
 * @property {HTMLElement} listbox - The listbox element
 *
 * @extends {Component}
 */
class SortingFilterComponent extends Component {
  requiredRefs = ['details', 'summary', 'listbox'];

  /**
   * Handles keyboard navigation in the sorting dropdown
   * @param {KeyboardEvent} event - The keyboard event
   */
  handleKeyDown = (event) => {
    const { listbox } = this.refs;
    if (!(listbox instanceof Element)) return;

    const options = Array.from(listbox.querySelectorAll('[role="option"]'));
    const currentFocused = options.find((option) => option instanceof HTMLElement && option.tabIndex === 0);
    let newFocusIndex = currentFocused ? options.indexOf(currentFocused) : 0;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        newFocusIndex = Math.min(newFocusIndex + 1, options.length - 1);
        this.#moveFocus(options, newFocusIndex);
        break;

      case 'ArrowUp':
        event.preventDefault();
        newFocusIndex = Math.max(newFocusIndex - 1, 0);
        this.#moveFocus(options, newFocusIndex);
        break;

      case 'Enter':
      case ' ':
        if (event.target instanceof Element) {
          const targetOption = event.target.closest('[role="option"]');
          if (targetOption) {
            event.preventDefault();
            this.#selectOption(targetOption);
          }
        }
        break;

      case 'Escape':
        event.preventDefault();
        this.#closeDropdown();
        break;
    }
  };

  /**
   * Handles details toggle event
   */
  handleToggle = () => {
    const { details, summary, listbox } = this.refs;
    if (!(details instanceof HTMLDetailsElement) || !(summary instanceof HTMLElement)) return;

    const isOpen = details.open;
    summary.setAttribute('aria-expanded', isOpen.toString());

    if (isOpen && listbox instanceof Element) {
      // Move focus to selected option when dropdown opens
      const selectedOption = listbox.querySelector('[aria-selected="true"]');
      if (selectedOption instanceof HTMLElement) {
        selectedOption.focus();
      }
    }
  };

  /**
   * Moves focus between options
   * @param {Element[]} options - The option elements
   * @param {number} newIndex - The index of the option to focus
   */
  #moveFocus(options, newIndex) {
    // Remove tabindex from all options
    options.forEach((option) => {
      if (option instanceof HTMLElement) {
        option.tabIndex = -1;
      }
    });

    // Set tabindex and focus on new option
    const targetOption = options[newIndex];
    if (targetOption instanceof HTMLElement) {
      targetOption.tabIndex = 0;
      targetOption.focus();
    }
  }

  /**
   * Selects an option and triggers form submission
   * @param {Element} option - The option element to select
   */
  #selectOption(option) {
    const input = option.querySelector('input[type="radio"]');
    if (input instanceof HTMLInputElement && option instanceof HTMLElement) {
      // Update aria-selected states
      this.querySelectorAll('[role="option"]').forEach((opt) => {
        opt.setAttribute('aria-selected', 'false');
      });
      option.setAttribute('aria-selected', 'true');

      // Trigger click on the input to ensure normal form behavior
      input.click();

      // Close dropdown and return focus (handles tabIndex reset)
      this.#closeDropdown();
    }
  }

  /**
   * Closes the dropdown and returns focus to summary
   */
  #closeDropdown() {
    const { details, summary } = this.refs;
    if (details instanceof HTMLDetailsElement) {
      // Reset focus to match the actual selected option
      const options = this.querySelectorAll('[role="option"]');
      const selectedOption = this.querySelector('[aria-selected="true"]');

      options.forEach((opt) => {
        if (opt instanceof HTMLElement) {
          opt.tabIndex = -1;
        }
      });

      if (selectedOption instanceof HTMLElement) {
        selectedOption.tabIndex = 0;
      }

      details.open = false;
      if (summary instanceof HTMLElement) {
        summary.focus();
      }
    }
  }

  /**
   * Updates filter and sorting
   * @param {Event} event - The change event
   */
  updateFilterAndSorting(event) {
    const facetsForm =
      this.closest('facets-form-component') || this.closest('.shopify-section')?.querySelector('facets-form-component');

    if (!(facetsForm instanceof FacetsFormComponent)) return;
    
    // Get the selected sort value
    let sortValue = null;
    if (event.target instanceof HTMLSelectElement) {
      sortValue = event.target.value;
    } else if (event.target instanceof HTMLInputElement && event.target.type === 'radio') {
      sortValue = event.target.value;
    } else {
      const selectedInput = this.querySelector('input[name="sort_by"]:checked, select[name="sort_by"]');
      if (selectedInput instanceof HTMLInputElement || selectedInput instanceof HTMLSelectElement) {
        sortValue = selectedInput.value;
      }
    }

    // Liste des options de tri personnalisées par metafields
    const customSortOptions = ['intensity_asc', 'intensity_desc', 'olfactive_notes_asc', 'olfactive_notes_desc'];
    const isCustomSort = sortValue && customSortOptions.includes(sortValue);

    const isMobile = window.innerWidth < 750;

    const shouldDisable = this.dataset.shouldUseSelectOnMobile === 'true';

    // Because we have a select element on mobile and a bunch of radio buttons on desktop,
    // we need to disable the input during "form-submission" to prevent duplicate entries.
    if (shouldDisable) {
      if (isMobile) {
        const inputs = this.querySelectorAll('input[name="sort_by"]');
        inputs.forEach((input) => {
          if (!(input instanceof HTMLInputElement)) return;
          input.disabled = true;
        });
      } else {
        const selectElement = this.querySelector('select[name="sort_by"]');
        if (!(selectElement instanceof HTMLSelectElement)) return;
        selectElement.disabled = true;
      }
    }

    // Si c'est un tri personnalisé, trier côté client au lieu de faire une requête serveur
    if (isCustomSort && sortValue) {
      // Mettre à jour l'URL avec le paramètre sort_by personnalisé
      const url = new URL(window.location.href);
      url.searchParams.set('sort_by', sortValue);
      history.pushState({ urlParameters: url.searchParams.toString() }, '', url.toString());
      
      // Trier les produits côté client
      this.sortProductsByMetafields(sortValue);
      
      this.updateFacetStatus(event);
    } else {
      // Comportement normal pour les tris Shopify standards
      facetsForm.updateFilters();
      this.updateFacetStatus(event);
    }

    // Re-enable the input after the form-submission
    if (shouldDisable) {
      if (isMobile) {
        const inputs = this.querySelectorAll('input[name="sort_by"]');
        inputs.forEach((input) => {
          if (!(input instanceof HTMLInputElement)) return;
          input.disabled = false;
        });
      } else {
        const selectElement = this.querySelector('select[name="sort_by"]');
        if (!(selectElement instanceof HTMLSelectElement)) return;
        selectElement.disabled = false;
      }
    }

    // Close the details element when a value is selected
    const { details } = this.refs;
    if (!(details instanceof HTMLDetailsElement)) return;
    details.open = false;
  }

  /**
   * Sorts products by metafields (client-side sorting)
   * @param {string} sortValue - The sort value (intensity_asc, intensity_desc, olfactive_notes_asc, olfactive_notes_desc)
   */
  sortProductsByMetafields(sortValue) {
    const productGrid = document.querySelector('.product-grid');
    if (!productGrid) return;

    const productItems = Array.from(productGrid.querySelectorAll('.product-grid__item'));
    if (productItems.length === 0) return;

    // Récupérer les données des produits depuis les attributs data-* des cartes
    const productsWithData = productItems
      .map((item) => {
        const productCard = item.querySelector('product-card');
        if (!(productCard instanceof HTMLElement)) return null;

        const productId = productCard.dataset.productId;
        
        // Récupérer l'intensité depuis l'attribut data-intensity
        let intensity = null;
        const intensityData = productCard.dataset.intensity;
        if (intensityData) {
          intensity = parseInt(intensityData, 10);
        }

        // Récupérer les notes olfactives depuis l'attribut data-olfactive-notes
        let olfactiveNotes = null;
        const olfactiveNotesData = productCard.dataset.olfactiveNotes;
        if (olfactiveNotesData) {
          olfactiveNotes = olfactiveNotesData;
        }

        return {
          element: item,
          productId,
          intensity,
          olfactiveNotes,
        };
      })
      .filter((product) => product !== null);

    // Trier selon le type de tri
    productsWithData.sort((a, b) => {
      switch (sortValue) {
        case 'intensity_asc':
          // Trier par intensité croissante (null en dernier)
          if (a.intensity === null && b.intensity === null) return 0;
          if (a.intensity === null) return 1;
          if (b.intensity === null) return -1;
          return a.intensity - b.intensity;

        case 'intensity_desc':
          // Trier par intensité décroissante (null en dernier)
          if (a.intensity === null && b.intensity === null) return 0;
          if (a.intensity === null) return 1;
          if (b.intensity === null) return -1;
          return b.intensity - a.intensity;

        case 'olfactive_notes_asc':
          // Trier par notes olfactives A-Z (null en dernier)
          if (!a.olfactiveNotes && !b.olfactiveNotes) return 0;
          if (!a.olfactiveNotes) return 1;
          if (!b.olfactiveNotes) return -1;
          return a.olfactiveNotes.localeCompare(b.olfactiveNotes, 'fr');

        case 'olfactive_notes_desc':
          // Trier par notes olfactives Z-A (null en dernier)
          if (!a.olfactiveNotes && !b.olfactiveNotes) return 0;
          if (!a.olfactiveNotes) return 1;
          if (!b.olfactiveNotes) return -1;
          return b.olfactiveNotes.localeCompare(a.olfactiveNotes, 'fr');

        default:
          return 0;
      }
    });

    // Réorganiser les éléments dans le DOM
    productsWithData.forEach(({ element }) => {
      productGrid.appendChild(element);
    });
  }

  /**
   * Updates the facet status
   * @param {Event} event - The change event
   */
  updateFacetStatus(event) {
    if (!(event.target instanceof HTMLSelectElement)) return;

    const details = this.querySelector('details');
    if (!details) return;

    const facetStatus = details.querySelector('facet-status-component');
    if (!(facetStatus instanceof FacetStatusComponent)) return;

    facetStatus.textContent =
      event.target.value !== details.dataset.defaultSortBy ? event.target.dataset.optionName ?? '' : '';
  }
}

if (!customElements.get('sorting-filter-component')) {
  customElements.define('sorting-filter-component', SortingFilterComponent);
}

// Appliquer le tri personnalisé au chargement de la page si présent dans l'URL
document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const sortBy = urlParams.get('sort_by');
  const customSortOptions = ['intensity_asc', 'intensity_desc', 'olfactive_notes_asc', 'olfactive_notes_desc'];
  
  if (sortBy && customSortOptions.includes(sortBy)) {
    // Attendre que le DOM soit complètement chargé
    setTimeout(() => {
      const sortingFilter = document.querySelector('sorting-filter-component');
      if (sortingFilter instanceof SortingFilterComponent) {
        sortingFilter.sortProductsByMetafields(sortBy);
      }
    }, 100);
  }
});

/**
 * @typedef {Object} FacetStatusRefs
 * @property {HTMLElement} facetStatus - The facet status element
 */

/**
 * Handles facet status display
 * @extends {Component<FacetStatusRefs>}
 */
class FacetStatusComponent extends Component {
  /**
   * Updates the list summary
   * @param {HTMLInputElement[]} checkedInputElements - The checked input elements
   */
  updateListSummary(checkedInputElements) {
    const checkedInputElementsCount = checkedInputElements.length;

    this.getAttribute('facet-type') === 'swatches'
      ? this.#updateSwatchSummary(checkedInputElements, checkedInputElementsCount)
      : this.#updateBubbleSummary(checkedInputElements, checkedInputElementsCount);
  }

  /**
   * Updates the swatch summary
   * @param {HTMLInputElement[]} checkedInputElements - The checked input elements
   * @param {number} checkedInputElementsCount - The number of checked inputs
   */
  #updateSwatchSummary(checkedInputElements, checkedInputElementsCount) {
    const { facetStatus } = this.refs;
    facetStatus.classList.remove('bubble', 'facets__bubble');

    if (checkedInputElementsCount === 0) {
      facetStatus.innerHTML = '';
      return;
    }

    if (checkedInputElementsCount > 3) {
      facetStatus.innerHTML = checkedInputElementsCount.toString();
      facetStatus.classList.add('bubble', 'facets__bubble');
      return;
    }

    facetStatus.innerHTML = Array.from(checkedInputElements)
      .map((inputElement) => {
        const swatch = inputElement.parentElement?.querySelector('span.swatch');
        return swatch?.outerHTML ?? '';
      })
      .join('');
  }

  /**
   * Updates the bubble summary
   * @param {HTMLInputElement[]} checkedInputElements - The checked input elements
   * @param {number} checkedInputElementsCount - The number of checked inputs
   */
  #updateBubbleSummary(checkedInputElements, checkedInputElementsCount) {
    const { facetStatus } = this.refs;
    const filterStyle = this.dataset.filterStyle;

    facetStatus.classList.remove('bubble', 'facets__bubble');

    if (checkedInputElementsCount === 0) {
      facetStatus.innerHTML = '';
      return;
    }

    if (filterStyle === 'horizontal' && checkedInputElementsCount === 1) {
      facetStatus.innerHTML = checkedInputElements[0]?.dataset.label ?? '';
      return;
    }

    facetStatus.innerHTML = checkedInputElementsCount.toString();
    facetStatus.classList.add('bubble', 'facets__bubble');
  }

  /**
   * Updates the price summary
   * @param {HTMLInputElement} minInput - The minimum price input
   * @param {HTMLInputElement} maxInput - The maximum price input
   */
  updatePriceSummary(minInput, maxInput) {
    const minInputValue = minInput.value;
    const maxInputValue = maxInput.value;
    const { facetStatus } = this.refs;

    if (!minInputValue && !maxInputValue) {
      facetStatus.innerHTML = '';
      return;
    }

    const minInputNum = this.#parseCents(minInputValue, '0');
    const maxInputNum = this.#parseCents(maxInputValue, facetStatus.dataset.rangeMax);
    facetStatus.innerHTML = `${this.#formatMoney(minInputNum)}–${this.#formatMoney(maxInputNum)}`;
  }

  /**
   * Parses a decimal number as cents
   * @param {string} value - The stringified decimal number to parse
   * @param {string} fallback - The fallback value in case `value` is invalid
   * @returns {number} The money value in cents
   */
  #parseCents(value, fallback = '0') {
    const parts = value ? value.trim().split(/[^0-9]/) : (parseInt(fallback, 10) / 100).toString();
    const [wholeStr, fractionStr, ...rest] = parts;
    if (typeof wholeStr !== 'string' || rest.length > 0) return parseInt(fallback, 10);

    const whole = parseInt(wholeStr, 10);
    let fraction = parseInt(fractionStr || '0', 10);

    // Use two most-significant digits, e.g. 1 -> 10, 12 -> 12, 123 -> 12.3, 1234 -> 12.34, etc
    fraction = fraction * Math.pow(10, 2 - fraction.toString().length);

    return whole * 100 + fraction;
  }

  /**
   * Formats money, replicated the implementation of the `money` liquid filters
   * @param {number} moneyValue - The money value
   * @returns {string} The formatted money value
   */
  #formatMoney(moneyValue) {
    if (!(this.refs.moneyFormat instanceof HTMLTemplateElement)) return '';

    const template = this.refs.moneyFormat.content.textContent || '{{amount}}';
    const currency = this.refs.facetStatus.dataset.currency || '';

    return template.replace(/{{\s*(\w+)\s*}}/g, (_, placeholder) => {
      if (typeof placeholder !== 'string') return '';
      if (placeholder === 'currency') return currency;

      let thousandsSeparator = ',';
      let decimalSeparator = '.';
      let precision = CURRENCY_DECIMALS[currency.toUpperCase()] ?? DEFAULT_CURRENCY_DECIMALS;

      if (placeholder === 'amount') {
        // Check first since it's the most common, use defaults.
      } else if (placeholder === 'amount_no_decimals') {
        precision = 0;
      } else if (placeholder === 'amount_with_comma_separator') {
        thousandsSeparator = '.';
        decimalSeparator = ',';
      } else if (placeholder === 'amount_no_decimals_with_comma_separator') {
        // Weirdly, this is correct. It uses amount_with_comma_separator's
        // behaviour but removes decimals, resulting in an unintuitive
        // output that can't possibly include commas, despite the name.
        thousandsSeparator = '.';
        precision = 0;
      } else if (placeholder === 'amount_no_decimals_with_space_separator') {
        thousandsSeparator = ' ';
        precision = 0;
      } else if (placeholder === 'amount_with_space_separator') {
        thousandsSeparator = ' ';
        decimalSeparator = ',';
      } else if (placeholder === 'amount_with_period_and_space_separator') {
        thousandsSeparator = ' ';
        decimalSeparator = '.';
      } else if (placeholder === 'amount_with_apostrophe_separator') {
        thousandsSeparator = "'";
        decimalSeparator = '.';
      }

      return this.#formatCents(moneyValue, thousandsSeparator, decimalSeparator, precision);
    });
  }

  /**
   * Formats money in cents
   * @param {number} moneyValue - The money value in cents (hundredths of one major currency unit)
   * @param {string} thousandsSeparator - The thousands separator
   * @param {string} decimalSeparator - The decimal separator
   * @param {number} precision - The precision
   * @returns {string} The formatted money value
   */
  #formatCents(moneyValue, thousandsSeparator, decimalSeparator, precision) {
    const roundedNumber = (moneyValue / 100).toFixed(precision);

    let [a, b] = roundedNumber.split('.');
    if (!a) a = '0';
    if (!b) b = '';

    // Split by groups of 3 digits
    a = a.replace(/\d(?=(\d\d\d)+(?!\d))/g, (digit) => digit + thousandsSeparator);

    return precision <= 0 ? a : a + decimalSeparator + b.padEnd(precision, '0');
  }

  /**
   * Clears the summary
   */
  clearSummary() {
    this.refs.facetStatus.innerHTML = '';
  }
}

if (!customElements.get('facet-status-component')) {
  customElements.define('facet-status-component', FacetStatusComponent);
}

/**
 * Default currency decimals used in most currenies
 * @constant {number}
 */
const DEFAULT_CURRENCY_DECIMALS = 2;

/**
 * Decimal precision for currencies that have a non-default precision
 * @type {Record<string, number>}
 */
const CURRENCY_DECIMALS = {
  BHD: 3,
  BIF: 0,
  BYR: 0,
  CLF: 4,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  IQD: 3,
  ISK: 0,
  JOD: 3,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  KWD: 3,
  LYD: 3,
  MRO: 5,
  OMR: 3,
  PYG: 0,
  RWF: 0,
  TND: 3,
  UGX: 0,
  UYI: 0,
  UYW: 4,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XAG: 0,
  XAU: 0,
  XBA: 0,
  XBB: 0,
  XBC: 0,
  XBD: 0,
  XDR: 0,
  XOF: 0,
  XPD: 0,
  XPF: 0,
  XPT: 0,
  XSU: 0,
  XTS: 0,
  XUA: 0,
};
