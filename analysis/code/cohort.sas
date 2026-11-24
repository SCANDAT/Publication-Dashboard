/* Cohort selection. The analysis begins with ICU measurements linked to candidate RBC
   starts, the transfusion extract and ICU admission histories. Extract creation and
   record linkage preceded these statements. Times in the eligibility comparisons are in
   seconds. */
/* Each labelled excerpt may begin or end within a SAS step. */

/* Select candidate records with a recognized outcome and a measurement time within 12
   hours of transfusion start. This screen uses the measurement time even when the value
   is missing. */
  data work._rps_index work._rps_irbad;
    length VitalCode $4 ReasonCode $48 ClinicalPatientID PersonKey 8;
    set &index(keep=StudyID PatientID TransDt Datetime Value AdmissionTime DischargeTime
      Age Sex WardName Abbreviation SAPS_3 Crystalloid_1 Crystalloid_24 Pressors_1 Pressors_24
      Sedatives_1 Sedatives_24 rename=(PatientID=ClinicalPatientID Age=PatientAge Sex=PatientSex
        AdmissionTime=StoredAdmissionTime DischargeTime=StoredDischargeTime));
    PersonKey=StudyID; VitalCode=''; ReasonCode='';
    select (strip(Abbreviation));
      when ('ARTm') VitalCode='ARTm'; when ('ARTs') VitalCode='ARTs';
      when ('ARTd') VitalCode='ARTd'; when ('FIO2(u)') VitalCode='FIO2';
      when ('SpO2') VitalCode='SPO2'; when ('VE(u)') VitalCode='VE';
      otherwise do;
        if strip(Abbreviation)=cats('Hj','E4'x,'rtfrekv') or
           strip(Abbreviation)=cats('Hj','C3A4'x,'rtfrekv') then VitalCode='HR';
      end;
    end;
    if cmiss(PersonKey,ClinicalPatientID,TransDt)>0 then ReasonCode='MISSING_SOURCE_EVENT_KEY';
    else if missing(VitalCode) then ReasonCode='OUTSIDE_DECLARED_OUTCOMES';
    else if missing(Datetime) then ReasonCode='MISSING_MEASUREMENT_TIME';
    else if Datetime<TransDt-43200 or Datetime>TransDt+43200 then ReasonCode='OUTSIDE_ANALYSIS_WINDOW';
    if missing(ReasonCode) then output work._rps_index;
    else output work._rps_irbad;
    drop Abbreviation;
  run;

/* Retrieve admission and RBC unit histories for the people in the linked extract. */
  proc sql noprint;
    select count(*) into :n_source trimmed from &index;
    create table work._rps_people as select distinct StudyID from &index where not missing(StudyID);
    create table work._rps_asrc as select a.StudyID,a.PatientID,a.AdmissionTime,a.DischargeTime
      from &admissions a inner join work._rps_people p on a.StudyID=p.StudyID;
    create table work._rps_lsrc as select l.StudyID,l.Poolnum,l.TransDt,l.TransDate,
      l.DonDate,l.Storage,l.DonorHb,l.DonorSex,l.DonorParity
      from &ledger l inner join work._rps_people p on l.StudyID=p.StudyID where l.XProdType='E';
  quit;

/* Parse admission times and identify invalid histories. */
  data work._rps_ap;
    set work._rps_asrc;
    StartDT=.; EndDT=.;
    if lengthn(strip(AdmissionTime))<=32 then StartDT=input(strip(AdmissionTime),?? anydtdtm32.);
    if lengthn(strip(DischargeTime))<=32 then EndDT=input(strip(DischargeTime),?? anydtdtm32.);
    Invalid=(cmiss(StudyID,PatientID,StartDT,EndDT)>0 or StartDT>EndDT);
    keep StudyID PatientID StartDT EndDT Invalid;
  run;
  proc sql noprint;
    create table work._rps_adm as select distinct StudyID,PatientID,StartDT,EndDT
      from work._rps_ap where Invalid=0;
    create table work._rps_abadhist as select distinct StudyID from work._rps_ap where Invalid=1;
    select count(*) into :n_admbad trimmed from work._rps_ap where Invalid=1;
    create table work._rps_akey as select PatientID from work._rps_adm
      group by PatientID having count(*) ne 1;
    select count(*) into :bad trimmed from work._rps_akey;
  quit;

/* Match the transfusion start to one ICU admission and check its identifiers and
   recorded times. Units starting together share an event key. Parse the recorded SAPS 3
   score. */
  proc sql;
    create table work._rps_ie as select distinct PersonKey,TransDt from work._rps_index;
    create table work._rps_acount as select e.PersonKey,e.TransDt,count(a.PatientID) as AdmissionMatches,
      min(a.PatientID) as MatchClinicalID,min(a.StartDT) as AdmissionTime,min(a.EndDT) as DischargeTime,
      max(not missing(b.StudyID)) as InvalidAdmissionHistory
      from work._rps_ie e left join work._rps_adm a on e.PersonKey=a.StudyID
        and a.StartDT<=e.TransDt and e.TransDt<=a.EndDT
      left join work._rps_abadhist b on e.PersonKey=b.StudyID
      group by e.PersonKey,e.TransDt;
    create table work._rps_link as select i.*,a.AdmissionMatches,a.MatchClinicalID,
      a.AdmissionTime,a.DischargeTime,a.InvalidAdmissionHistory
      from work._rps_index i inner join work._rps_acount a
        on i.PersonKey=a.PersonKey and i.TransDt=a.TransDt;
  quit;
  data work._rps_linkgood work._rps_linkbad;
    set work._rps_link;
    length RBC_EventKey ICUAdmissionKey $80 SAPS3_Status $16;
    ReasonCode='';
    if InvalidAdmissionHistory then ReasonCode='INVALID_ADMISSION_HISTORY';
    else if AdmissionMatches=0 then ReasonCode='NO_ADMISSION_CONTAINS_INDEX';
    else if AdmissionMatches>1 then ReasonCode='MULTIPLE_ADMISSIONS_CONTAIN_INDEX';
    else if ClinicalPatientID ne MatchClinicalID then ReasonCode='STORED_CLINICAL_ID_MISMATCH';
    else if cmiss(StoredAdmissionTime,StoredDischargeTime)>0 or StoredAdmissionTime ne AdmissionTime
      or StoredDischargeTime ne DischargeTime then ReasonCode='STORED_ADMISSION_BOUNDS_MISMATCH';
    RBC_EventKey=cats('E',put(PersonKey,hex16.),'_',put(TransDt,hex16.));
    ICUAdmissionKey=cats('A',put(PersonKey,hex16.),'_',put(ClinicalPatientID,hex16.));
    SAPS3=.;
    if missing(SAPS_3) then SAPS3_Status='MISSING';
    else if lengthn(strip(SAPS_3))<=32 and
      prxmatch('/^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$/',strip(SAPS_3)) then do;
      SAPS3=input(strip(SAPS_3),?? best32.);
      if missing(SAPS3) then SAPS3_Status='INVALID'; else SAPS3_Status='VALID';
    end;
    else SAPS3_Status='INVALID';
    if missing(ReasonCode) then output work._rps_linkgood;
    else output work._rps_linkbad;
  run;
  proc sql noprint;
    create table work._rps_profiles as select distinct PersonKey,ClinicalPatientID,TransDt,
      RBC_EventKey,ICUAdmissionKey,AdmissionTime,DischargeTime,PatientAge,PatientSex,WardName,SAPS_3,SAPS3,SAPS3_Status
      from work._rps_linkgood;
    create table work._rps_pconf as select RBC_EventKey from work._rps_profiles
      group by RBC_EventKey having count(*) ne 1;
    select count(*) into :bad trimmed from work._rps_pconf;
  quit;

/* Identify each RBC unit and derive its donation weekday. */
  data work._rps_ld;
    set work._rps_lsrc;
    length RBC_UnitKey $80 StoredLedgerDateKind $16;
    PersonKey=StudyID;
    UnitDate=datepart(TransDt);
    RBC_UnitKey=cats('U',put(PersonKey,hex16.),'_',put(UnitDate,hex16.),'_',put(Poolnum,hex16.));
    if missing(TransDate) then StoredLedgerDateKind='MISSING';
    else if TransDate=UnitDate then StoredLedgerDateKind='DATE';
    else if datepart(TransDate)=UnitDate then StoredLedgerDateKind='DATETIME';
    else StoredLedgerDateKind='INCONSISTENT';
    %if %upcase(&donation_date_unit)=DATETIME %then %do;
      if missing(DonDate) then wdy_donation=.; else wdy_donation=weekday(datepart(DonDate));
    %end;
    %else %do;
      if missing(DonDate) then wdy_donation=.; else wdy_donation=weekday(DonDate);
    %end;
    InvalidUnitKey=(cmiss(PersonKey,TransDt,Poolnum)>0 or Poolnum<1 or Poolnum ne floor(Poolnum));
    format _numeric_ best32.;
  run;

/* Collapse duplicate copies of a unit before assigning units to admissions. */
  proc sort data=work._rps_ld nodupkey; by _all_; run;
  proc sql noprint;
    create table work._rps_ldup as select RBC_UnitKey from work._rps_ld
      group by RBC_UnitKey having count(*) ne 1;
    select count(*) into :bad trimmed from work._rps_ldup;
    select count(*) into :n_units trimmed from work._rps_ld;
  quit;

/* Assign each unit to an admission using the same time boundaries. */
  proc sql;
    create table work._rps_umap as select u.RBC_UnitKey,count(a.PatientID) as UnitAdmissionMatches,
      min(a.PatientID) as MatchClinicalID,min(a.StartDT) as AdmissionTime,min(a.EndDT) as DischargeTime
      from work._rps_ld u left join work._rps_adm a on u.PersonKey=a.StudyID
        and a.StartDT<=u.TransDt and u.TransDt<=a.EndDT group by u.RBC_UnitKey;
    create table work._rps_units as select u.*,m.UnitAdmissionMatches,m.MatchClinicalID,
      m.AdmissionTime,m.DischargeTime from work._rps_ld u inner join work._rps_umap m
        on u.RBC_UnitKey=m.RBC_UnitKey;
  quit;
  data work._rps_units;
    set work._rps_units;
    length ICUAdmissionKey $80 UnitAdmissionStatus $24;
    ClinicalPatientID=.; ICUAdmissionKey='';
    if UnitAdmissionMatches=1 then do;
      ClinicalPatientID=MatchClinicalID;
      ICUAdmissionKey=cats('A',put(PersonKey,hex16.),'_',put(ClinicalPatientID,hex16.));
      UnitAdmissionStatus='UNIQUE';
    end;
    else do;
      AdmissionTime=.; DischargeTime=.;
      if UnitAdmissionMatches=0 then UnitAdmissionStatus='NO_MATCH';
      else UnitAdmissionStatus='AMBIGUOUS';
    end;
    drop MatchClinicalID InvalidUnitKey;
  run;

/* Calculate the previous start and the number of units already received in the
   admission. The index start itself is excluded from both counts. Check eligibility
   before looking forward. */
  data work._rps_histstack;
    length RBC_EventKey $80;
    set work._rps_units(in=u keep=PersonKey TransDt)
        work._rps_profiles(in=e keep=PersonKey TransDt RBC_EventKey);
    if e then RowType=0;
    else do; RowType=1; RBC_EventKey=''; end;
  run;
  proc sort data=work._rps_histstack; by PersonKey TransDt RowType; run;
  data work._rps_hist(keep=RBC_EventKey PreviousUnitTime);
    set work._rps_histstack; by PersonKey TransDt RowType;
    retain PreviousUnitTime;
    if first.PersonKey then PreviousUnitTime=.;
    if RowType=0 then output;
    else PreviousUnitTime=TransDt;
  run;
  data work._rps_ecountstack;
    length RBC_EventKey $80;
    set work._rps_units(in=u where=(UnitAdmissionMatches=1)
          keep=PersonKey TransDt ICUAdmissionKey UnitAdmissionMatches)
        work._rps_profiles(in=e keep=PersonKey TransDt ICUAdmissionKey RBC_EventKey);
    if e then RowType=0;
    else do; RowType=1; RBC_EventKey=''; end;
  run;
  proc sort data=work._rps_ecountstack; by PersonKey ICUAdmissionKey TransDt RowType; run;
  data work._rps_prior(keep=RBC_EventKey RBC_Count);
    set work._rps_ecountstack; by PersonKey ICUAdmissionKey TransDt RowType;
    retain RBC_Count;
    if first.ICUAdmissionKey then RBC_Count=0;
    if RowType=0 then output; else RBC_Count+1;
  run;
  proc sql;
    create table work._rps_hcounts as select e.RBC_EventKey,count(u.RBC_UnitKey) as NIndexUnits
      from work._rps_profiles e left join work._rps_units u
        on e.PersonKey=u.PersonKey and e.TransDt=u.TransDt group by e.RBC_EventKey;
    create table work._rps_ambprior as select e.RBC_EventKey,count(u.RBC_UnitKey) as NAmbiguousPriorUnits
      from work._rps_profiles e left join work._rps_units u on e.PersonKey=u.PersonKey
        and u.TransDt>=e.AdmissionTime and u.TransDt<e.TransDt and u.UnitAdmissionMatches ne 1
      group by e.RBC_EventKey;
    create table work._rps_eventhistory as select e.*,h.PreviousUnitTime,p.RBC_Count,
      n.NIndexUnits,a.NAmbiguousPriorUnits from work._rps_profiles e
      inner join work._rps_hist h on e.RBC_EventKey=h.RBC_EventKey
      inner join work._rps_prior p on e.RBC_EventKey=p.RBC_EventKey
      inner join work._rps_hcounts n on e.RBC_EventKey=n.RBC_EventKey
      inner join work._rps_ambprior a on e.RBC_EventKey=a.RBC_EventKey;
  quit;
  data work._rps_eaccept work._rps_ebad;
    set work._rps_eventhistory;
    length ReasonCode $48 WardCode $256;
    ReasonCode=''; WardCode=WardName;
    if NIndexUnits=0 then ReasonCode='INDEX_EVENT_ABSENT_FROM_LEDGER';
    else if NAmbiguousPriorUnits>0 then ReasonCode='AMBIGUOUS_PRIOR_UNIT_ADMISSION';
    else if not missing(PreviousUnitTime) and PreviousUnitTime>=TransDt-43200
      then ReasonCode='PREVIOUS_RBC_WITHIN_OR_AT_MINUS12H';
    ICU_time=(TransDt-AdmissionTime)/60;
    if missing(ReasonCode) then output work._rps_eaccept; else output work._rps_ebad;
  run;
  proc sql noprint;
    select count(*) into :n_final trimmed from work._rps_eaccept;
    create table work._rps_indexunits as select u.*,e.RBC_EventKey from work._rps_units u
      inner join work._rps_eaccept e on u.PersonKey=e.PersonKey and u.TransDt=e.TransDt;
  quit;

/* Attach the event categories from categories.sas and group measurement records by
   event, outcome and timestamp. */
  proc sql;
    create table work._rps_events as select e.*,c.DonorHb_Cat,c.Storage_Cat,c.DonorSex,
      c.DonorParity_Female,c.DonorParity,c.wdy_donation from work._rps_eaccept e
      inner join work._rps_catwide c on e.RBC_EventKey=c.RBC_EventKey;
    create table work._rps_payload as select distinct i.PersonKey,i.ClinicalPatientID,i.RBC_EventKey,
      i.ICUAdmissionKey,i.TransDt,i.Datetime,i.VitalCode,i.Value,i.PatientAge,i.PatientSex,i.WardName,
      i.Crystalloid_1,i.Crystalloid_24,i.Pressors_1,i.Pressors_24,i.Sedatives_1,i.Sedatives_24,
      e.AdmissionTime,e.DischargeTime,e.ICU_time,e.RBC_Count,
      e.DonorHb_Cat,e.Storage_Cat,e.DonorSex,e.DonorParity_Female,e.DonorParity,e.wdy_donation
      from work._rps_linkgood i inner join work._rps_events e on i.RBC_EventKey=e.RBC_EventKey;
    create table work._rps_payloadconf as select RBC_EventKey,VitalCode,Datetime from work._rps_payload
      group by RBC_EventKey,VitalCode,Datetime having count(*) ne 1;
  quit;

/* For each repeated event, outcome and time, _rps_cfield records the distinct values,
   missingness and ranges. Copies must agree on the outcome (n1). For the six treatment
   summaries, check whether differences fall within the rounding tolerance. The sixth
   summary covers sedative/analgesic use over 24 hours. */
    data work._rps_normgate;
      set work._rps_cfield;
      array n[7] n1-n7; array hi[7] hi1-hi7;
      array mn[6] mn2-mn7; array mx[6] mx2-mx7;
      Allowed=(n1=1); NormalizedFields=0;
      do j=1 to 6;
        if n[j+1]>1 then do;
          NormalizedFields+1;
          if hi[j+1]=1 or missing(mn[j]) or missing(mx[j]) then Allowed=0;
          else if not ((mn[j]>0 and mx[j]>0) or (mn[j]<0 and mx[j]<0) or
              (mn[j]=0 and mx[j]=0)) then Allowed=0;
          else do;
            Magnitude=max(abs(mn[j]),abs(mx[j]));
            Limit=32*constant('MACEPS')*Magnitude;
            Gap=mx[j]-mn[j];
            %if %upcase(&medication_reconciliation)=FLOAT32_SED24_REL12 %then %do;
              if j=6 then do;
                if Magnitude>0 then RelativeGap=Gap/Magnitude;
                else if Gap=0 then RelativeGap=0;
                else RelativeGap=.;
                if missing(RelativeGap) or RelativeGap>1e-12 then Allowed=0;
              end;
              else if missing(Limit) or missing(Gap) or Gap>Limit then Allowed=0;
            %end;
            %else %do;
              if missing(Limit) or missing(Gap) or Gap>Limit then Allowed=0;
            %end;
          end;
        end;
      end;
      drop j Magnitude Limit Gap;
      %if %upcase(&medication_reconciliation)=FLOAT32_SED24_REL12 %then %do;
        drop RelativeGap;
      %end;
    run;

/* Resolve permitted rounding differences. Check for remaining groups with more than one
   measurement record. */
    %if &bad>0 %then %do; %rps_fail(CONFLICTING_ANALYSIS_PAYLOAD); %goto finish; %end;
    proc sql;
      create table work._rps_normalized as select distinct
        i.PersonKey,i.ClinicalPatientID,i.RBC_EventKey,i.ICUAdmissionKey,i.TransDt,
        i.Datetime,i.VitalCode,i.Value,i.PatientAge,i.PatientSex,i.WardName,
        case when c.n2>1 then c.mn2 else i.Crystalloid_1 end as Crystalloid_1,
        case when c.n3>1 then c.mn3 else i.Crystalloid_24 end as Crystalloid_24,
        case when c.n4>1 then c.mn4 else i.Pressors_1 end as Pressors_1,
        case when c.n5>1 then c.mn5 else i.Pressors_24 end as Pressors_24,
        case when c.n6>1 then c.mn6 else i.Sedatives_1 end as Sedatives_1,
        case when c.n7>1 then c.mn7 else i.Sedatives_24 end as Sedatives_24,
        i.AdmissionTime,i.DischargeTime,i.ICU_time,i.RBC_Count,
        i.DonorHb_Cat,i.Storage_Cat,i.DonorSex,i.DonorParity_Female,i.DonorParity,i.wdy_donation
      from work._rps_payload i left join work._rps_normgate c
        on i.RBC_EventKey=c.RBC_EventKey and i.VitalCode=c.VitalCode and i.Datetime=c.Datetime;
      create table work._rps_payloadconf as select RBC_EventKey,VitalCode,Datetime
        from work._rps_normalized group by RBC_EventKey,VitalCode,Datetime having count(*) ne 1;
    quit;
    proc sql noprint; select count(*) into :bad trimmed from work._rps_payloadconf; quit;
    %rps_step(FACTOR_AND_MEASUREMENT_RECONCILIATION);
    %if &RBC_PREPARE_ERROR ne NONE %then %goto finish;
    %if &bad>0 %then %do; %rps_fail(CONFLICTING_ANALYSIS_PAYLOAD); %goto finish; %end;

/* Store the reconciled measurements from _rps_long as canonical_long. Relative time is
   in minutes. The study used model_grouping=PERSON so the model's PatientID identifies
   the same person across ICU stays. */
  data work._rps_long;
    %if &n_normgroups>0 %then %do; set work._rps_normalized; %end;
    %else %do; set work._rps_payload; %end;
    TimeFromTransfusion=(Datetime-TransDt)/60;
    if missing(Sedatives_1) then Sedatives_1_bin=Sedatives_1; else Sedatives_1_bin=(Sedatives_1>0);
    if missing(Sedatives_24) then Sedatives_24_bin=Sedatives_24; else Sedatives_24_bin=(Sedatives_24>0);
    PatientID=.;
    %if %upcase(&model_grouping)=PERSON %then %do; PatientID=PersonKey; %end;
  run;

/* The coverage table supplies the transfusion extract's observation interval for each
   person. Merge overlapping intervals within a person. */
  proc sort data=&coverage(keep=PersonKey CoverageStart CoverageEnd)
    out=work._rpop_csort;
    by PersonKey CoverageStart CoverageEnd;
  run;
  %if &syscc>4 or &syserr>4 %then %goto sas_failure;
  data work._rpop_merged(keep=PersonKey VerifiedStart VerifiedEnd);
    set work._rpop_csort;
    by PersonKey;
    retain VerifiedStart VerifiedEnd;
    if first.PersonKey then do;
      VerifiedStart=CoverageStart; VerifiedEnd=CoverageEnd;
    end;
    else if CoverageStart<=VerifiedEnd then VerifiedEnd=max(VerifiedEnd,CoverageEnd);
    else do;
      output; VerifiedStart=CoverageStart; VerifiedEnd=CoverageEnd;
    end;
    if last.PersonKey then output;
  run;

/* Use canonical_events (&events) to find the earliest eligible event. Search the full
   unit history (&units) for later starts up to and including hour 12. In this study the
   coverage end was exclusive. */
  proc sql noprint;
    create table work._rpop_min as
      select PersonKey,min(TransDt) as FirstTime from &events group by PersonKey;
    create table work._rpop_future as
      select e.RBC_EventKey,count(u.RBC_UnitKey) as NFollowingUnits
      from &events e left join &units u on e.PersonKey=u.PersonKey and
        u.TransDt>e.TransDt and u.TransDt<=e.TransDt+43200
      group by e.RBC_EventKey;
    create table work._rpop_cover as
      select e.RBC_EventKey,count(c.PersonKey) as CoverageMatches
      from &events e left join work._rpop_merged c on e.PersonKey=c.PersonKey and
        c.VerifiedStart<=e.TransDt and c.VerifiedEnd
          %if &end_boundary=EXCLUSIVE %then %do; > %end;
          %else %do; >= %end;
          e.TransDt+43200
      group by e.RBC_EventKey;
  quit;

/* Assign the two sensitivity cohorts separately so that an event can belong to both. */
  proc sql noprint;
    create table &outlib..population_flags as
      select e.PersonKey,e.TransDt,e.RBC_EventKey,
        (e.TransDt=m.FirstTime) as FirstEligibleEvent,
        f.NFollowingUnits,(c.CoverageMatches=1) as FutureCoverageComplete,
        (f.NFollowingUnits=0 and c.CoverageMatches=1) as NoFollowingUnit12H
      from &events e inner join work._rpop_min m on e.PersonKey=m.PersonKey
      inner join work._rpop_future f on e.RBC_EventKey=f.RBC_EventKey
      inner join work._rpop_cover c on e.RBC_EventKey=c.RBC_EventKey;
  quit;

/* Record membership in each cohort. FollowupStatus, used in the counts below,
   classifies events by a later recorded unit, complete coverage without a later unit,
   or incomplete follow-up. */
  data &outlib..population_members;
    length PopulationId $32;
    set &outlib..population_flags;
    PopulationId='PRIMARY'; output;
    if FirstEligibleEvent then do; PopulationId='FIRST_EVENT'; output; end;
    if NoFollowingUnit12H then do; PopulationId='NO_FOLLOWING_UNIT_12H'; output; end;
  run;
  data work._rpop_seed;
    length PopulationId $32;
    PopulationId='PRIMARY'; output;
    PopulationId='FIRST_EVENT'; output;
    PopulationId='NO_FOLLOWING_UNIT_12H'; output;
  run;

/* The cohort flow diagram uses population_counts for the number of patients and events
   in each sensitivity cohort. */
  proc sql noprint;
    create table &outlib..population_counts as
      select s.PopulationId,'AVAILABLE' as PopulationStatus length=40,
        count(m.RBC_EventKey) as NEvents,
        count(distinct m.PersonKey) as NPersons
      from work._rpop_seed s left join &outlib..population_members m
        on s.PopulationId=m.PopulationId group by s.PopulationId;
    create table &outlib..followup_counts as
      select FollowupStatus,count(*) as NEvents,count(distinct PersonKey) as NPersons
      from &outlib..population_flags group by FollowupStatus;
  quit;

/* Select the cohort's events (_rgr_events) from canonical_events, the eligible events
   retained after the admission and transfusion-history checks. Link the corresponding
   measurements and units. */
 proc sql noprint;
  create table work._rgr_events as select e.* from &preparedlib..canonical_events e
   inner join &preparedlib..population_members p on e.RBC_EventKey=p.RBC_EventKey where p.PopulationId="&population_id";
  select count(*) into :n trimmed from work._rgr_events;
  create table work._rgr_long as select e.* from &preparedlib..canonical_long e
   inner join work._rgr_events p on e.RBC_EventKey=p.RBC_EventKey;
  create table work._rgr_units as select e.* from &preparedlib..index_units e
   inner join work._rgr_events p on e.RBC_EventKey=p.RBC_EventKey;
  create table work._rgr_groups as select e.* from &preparedlib..event_factor_eligibility e
   inner join work._rgr_events p on e.RBC_EventKey=p.RBC_EventKey;
 quit;

/* For Table 1, _rdd_events contains the descriptive fields from _rgr_events. Select one
   record for each patient at the first eligible event in this cohort. */
  proc sql;
    create table work._rdd_first as select PersonKey,min(TransDt) as FirstTime,
      count(*) as NEvents from work._rdd_events group by PersonKey;
    create table work._rdd_anchor as select distinct e.PersonKey,e.TransDt,e.PatientAge,
      e.PatientSex,e.WardCode,e.ICUAdmissionKey,e.AdmissionTime,e.DischargeTime,
      e.SAPS3,e.SAPS3_Status from work._rdd_events e inner join work._rdd_first f
      on e.PersonKey=f.PersonKey and e.TransDt=f.FirstTime;
    create table work._rdd_ties as select PersonKey from work._rdd_anchor
      group by PersonKey having count(*) ne 1;
  quit;

/* Count patients, admissions, eligible events and linked units. The primary cohort
   totals in Figure S1 and Table 1 come from these four counts. */
  proc sql;
    create table work._rdd_counts as
      select 'PERSONS' as CountingUnit length=24,count(*) as Count,
        'ONE_PERSON_AT_FIRST_ELIGIBLE_EVENT' as CountDefinition length=64 from work._rdd_anchor
      union all select 'ICU_ADMISSIONS',count(distinct ICUAdmissionKey),'CANONICAL_ADMISSIONS_IN_SUPPLIED_EVENTS' from work._rdd_events
      union all select 'INDEX_EVENTS',count(*),'SUPPLIED_ELIGIBLE_INDEX_EVENTS' from work._rdd_events
      union all select 'LINKED_PHYSICAL_UNITS',count(*),'PHYSICAL_UNITS_LINKED_TO_SUPPLIED_ELIGIBLE_INDEX_EVENTS' from work._rdd_units;
