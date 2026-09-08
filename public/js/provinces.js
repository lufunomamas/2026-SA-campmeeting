const SA_PROVINCES = [
  'Eastern Cape',
  'Free State',
  'Gauteng',
  'KwaZulu-Natal',
  'Limpopo',
  'Mpumalanga',
  'North West',
  'Northern Cape',
  'Western Cape',
];

function populateProvinceSelect(select, blankLabel) {
  select.innerHTML =
    (blankLabel ? `<option value="">${blankLabel}</option>` : '') +
    SA_PROVINCES.map((p) => `<option value="${p}">${p}</option>`).join('');
}
