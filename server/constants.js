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

const EVENT_DEFAULTS = {
  event_name: 'South Africa Campmeeting',
  event_location: 'Cullinan, Gauteng',
  event_start: '2026-12-27',
  event_end: '2027-01-02',
};

const REQUISITION_PRIORITIES = ['Very high', '1', '2', '3', '4', '5', 'Very low'];
const PAYMENT_METHODS = ['Cash', 'Bank', 'Cash Send'];
const REQUISITION_STATUSES = ['pending', 'approved', 'declined', 'review'];

module.exports = {
  SA_PROVINCES,
  EVENT_DEFAULTS,
  REQUISITION_PRIORITIES,
  PAYMENT_METHODS,
  REQUISITION_STATUSES,
};
