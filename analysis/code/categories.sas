/* Blood unit characteristics. Hemoglobin concentration is recorded in g/L and storage
   duration in days. Donor parity is the recorded binary field for female donors. */
/* Each labelled excerpt may begin or end within a SAS step. */

/* Inputs and derived categories. */
%macro rbc_derive_category_fields(
    hb=DonorHb,
    storage=Storage,
    sex=DonorSex,
    parity=DonorParity,
    hb_cat=DonorHb_Cat,
    storage_cat=Storage_Cat,
    parity_cat=DonorParity_Female
);

/* Missing values have no analysis category. */
    &hb_cat = .;
    &storage_cat = .;
    &parity_cat = .;
    RBC_Parity_Female = 0;
    RBC_Hb_Status = 'missing';
    RBC_Storage_Status = 'missing';
    RBC_DonorSex_Status = 'missing';
    RBC_Parity_Status = 'sex_missing';
    RBC_Hb_Label = 'Unknown';
    RBC_Storage_Label = 'Unknown';
    RBC_Parity_Label = 'Not eligible: donor sex missing';

/* Hemoglobin and storage thresholds apply before rounding. The sex and parity rules
   distinguish missing, invalid and eligible values. */
    if not missing(&hb) then do;
        RBC_Hb_Status = 'observed';
        if &hb < 125 then do;
            &hb_cat = 1; RBC_Hb_Label = '<125';
        end;
        else if &hb < 140 then do;
            &hb_cat = 2; RBC_Hb_Label = '125-<140';
        end;
        else if &hb < 155 then do;
            &hb_cat = 3; RBC_Hb_Label = '140-<155';
        end;
        else if &hb < 170 then do;
            &hb_cat = 4; RBC_Hb_Label = '155-<170';
        end;
        else do;
            &hb_cat = 5; RBC_Hb_Label = '>=170';
        end;
    end;

    if not missing(&storage) then do;
        if &storage < 0 then do;
            RBC_Storage_Status = 'negative';
            RBC_Storage_Label = 'Invalid';
        end;
        else do;
            RBC_Storage_Status = 'valid';
            if &storage < 10 then do;
                &storage_cat = 1; RBC_Storage_Label = '0-<10';
            end;
            else if &storage < 20 then do;
                &storage_cat = 2; RBC_Storage_Label = '10-<20';
            end;
            else if &storage < 30 then do;
                &storage_cat = 3; RBC_Storage_Label = '20-<30';
            end;
            else if &storage < 40 then do;
                &storage_cat = 4; RBC_Storage_Label = '30-<40';
            end;
            else do;
                &storage_cat = 5; RBC_Storage_Label = '>=40';
            end;
        end;
    end;

    if not missing(&sex) then do;
        if &sex = 1 then do;
            RBC_DonorSex_Status = 'male';
            RBC_Parity_Status = 'not_female';
            RBC_Parity_Label = 'Not eligible: male donor';
        end;
        else if &sex = 2 then do;
            RBC_DonorSex_Status = 'female';
            RBC_Parity_Female = 1;
            if missing(&parity) then do;
                RBC_Parity_Status = 'parity_missing';
                RBC_Parity_Label = 'Unknown';
            end;
            else if &parity in (0, 1) then do;
                &parity_cat = &parity;
                RBC_Parity_Status = 'eligible';
                if &parity = 0 then RBC_Parity_Label = 'Parity 0';
                else RBC_Parity_Label = 'Parity 1';
            end;
            else do;
                RBC_Parity_Status = 'parity_invalid';
                RBC_Parity_Label = 'Invalid';
            end;
        end;
        else do;
            RBC_DonorSex_Status = 'invalid';
            RBC_Parity_Status = 'sex_invalid';
            RBC_Parity_Label = 'Not eligible: donor sex invalid';
        end;
    end;
%mend rbc_derive_category_fields;

/* Each characteristic is assessed separately. All units starting at the event must
   belong to the same known category. MAIN includes every eligible event. */
  data work._rps_cats;
    set work._rps_indexunits;
    %rbc_derive_category_fields;
    ValidSex=(DonorSex in (1,2)); ValidWeekday=(wdy_donation in (1,2,3,4,5,6,7));
  run;
  proc sql;
    create table work._rps_catwide as select PersonKey,RBC_EventKey,count(*) as NUnits,
      count(DonorHb_Cat) as KnownHb,min(DonorHb_Cat) as MinHb,max(DonorHb_Cat) as MaxHb,
      count(Storage_Cat) as KnownStorage,min(Storage_Cat) as MinStorage,max(Storage_Cat) as MaxStorage,
      sum(ValidSex) as KnownSex,min(DonorSex) as MinSex,max(DonorSex) as MaxSex,
      sum(DonorSex=2) as NFemale,count(DonorParity_Female) as KnownParity,
      min(DonorParity_Female) as MinParity,max(DonorParity_Female) as MaxParity,
      sum(ValidWeekday) as KnownWeekday,min(wdy_donation) as MinWeekday,max(wdy_donation) as MaxWeekday
      from work._rps_cats group by PersonKey,RBC_EventKey;
  quit;
  data work._rps_factors(keep=PersonKey RBC_EventKey Factor CategoryCode Eligible ReasonCode NUnits)
       work._rps_catwide(keep=PersonKey RBC_EventKey NUnits DonorHb_Cat Storage_Cat DonorSex DonorParity_Female DonorParity wdy_donation);
    set work._rps_catwide;
    length Factor $32 ReasonCode $48;
    DonorHb_Cat=.; Storage_Cat=.; DonorSex=.; DonorParity_Female=.; DonorParity=.; wdy_donation=.;
    Factor='MAIN'; Eligible=1; CategoryCode=1; ReasonCode='ALL_CANONICAL_EVENTS'; output work._rps_factors;
    Factor='DonorHb_Cat'; Eligible=(KnownHb=NUnits and MinHb=MaxHb);
    CategoryCode=.; ReasonCode='UNKNOWN_OR_INVALID_UNIT_CATEGORY';
    if Eligible then do; CategoryCode=MinHb; DonorHb_Cat=MinHb; ReasonCode='ALL_UNITS_SAME_KNOWN_CATEGORY'; end;
    else if KnownHb=NUnits then ReasonCode='MIXED_UNIT_CATEGORIES';
    output work._rps_factors;
    Factor='Storage_Cat'; Eligible=(KnownStorage=NUnits and MinStorage=MaxStorage);
    CategoryCode=.; ReasonCode='UNKNOWN_OR_INVALID_UNIT_CATEGORY';
    if Eligible then do; CategoryCode=MinStorage; Storage_Cat=MinStorage; ReasonCode='ALL_UNITS_SAME_KNOWN_CATEGORY'; end;
    else if KnownStorage=NUnits then ReasonCode='MIXED_UNIT_CATEGORIES';
    output work._rps_factors;
    Factor='DonorSex'; Eligible=(KnownSex=NUnits and MinSex=MaxSex);
    CategoryCode=.; ReasonCode='UNKNOWN_OR_INVALID_UNIT_CATEGORY';
    if Eligible then do; CategoryCode=MinSex; DonorSex=MinSex; ReasonCode='ALL_UNITS_SAME_KNOWN_CATEGORY'; end;
    else if KnownSex=NUnits then ReasonCode='MIXED_UNIT_CATEGORIES';
    output work._rps_factors;
    Factor='DonorParity_Female'; Eligible=(NFemale=NUnits and KnownParity=NUnits and MinParity=MaxParity);
    CategoryCode=.; ReasonCode='NONFEMALE_OR_UNKNOWN_DONOR';
    if Eligible then do; CategoryCode=MinParity; DonorParity_Female=MinParity; DonorParity=MinParity; ReasonCode='ALL_UNITS_SAME_KNOWN_CATEGORY'; end;
    else if NFemale=NUnits then do;
      if KnownParity<NUnits then ReasonCode='UNKNOWN_OR_INVALID_UNIT_CATEGORY'; else ReasonCode='MIXED_UNIT_CATEGORIES';
    end;
    output work._rps_factors;
    Factor='wdy_donation'; Eligible=(KnownWeekday=NUnits and MinWeekday=MaxWeekday);
    CategoryCode=.; ReasonCode='UNKNOWN_OR_INVALID_UNIT_CATEGORY';
    if Eligible then do; CategoryCode=MinWeekday; wdy_donation=MinWeekday; ReasonCode='ALL_UNITS_SAME_KNOWN_CATEGORY'; end;
    else if KnownWeekday=NUnits then ReasonCode='MIXED_UNIT_CATEGORIES';
    output work._rps_factors;
    output work._rps_catwide;
  run;
