-- What hh states about the candidate in the resume itself: the city, the
-- readiness to relocate and to travel on business, the acceptable commute.
alter table resume add column if not exists area_name text;
alter table resume add column if not exists relocation text;
alter table resume add column if not exists business_trip_readiness text;
alter table resume add column if not exists travel_time text;
