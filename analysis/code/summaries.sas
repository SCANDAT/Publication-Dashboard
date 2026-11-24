/* Observed changes in Table 2. The two windows include their endpoints. An event
   contributes once to a paired comparison for each outcome with recorded values in both
   windows. */
/* Each labelled excerpt may begin or end within a SAS step. */

/* Call rbc_observed_summaries with the selected cohort's events, measurements and
   category assignments. */
  %rbc_observed_summaries(events=work._rgr_events,measurements=work._rgr_long,groups=work._rgr_groups,
   levels=&preparedlib..factor_levels,outlib=&outlib,run_id=&report_run_id,analysis_spec_id=&analysis_spec_id,
   cohort_mode=&cohort_mode,population_id=&population_id,mapping_verified=YES,
   measurement_grain=ONE_EVENT_OUTCOME_TIMESTAMP,factor_policy=ALL_UNITS_KNOWN_SAME_CATEGORY,
   window_policy=LEGACY_60_PLUS_MINUS_5_INCLUSIVE,weighting=EQUAL_MEASUREMENT_THEN_PAIRED_EVENT,
   inference=SURVEYREG_TAYLOR_NONE_T);

/* Keep the event and measurement fields used for the observed comparisons. */
  data work._rob_events; set &events(keep=PersonKey RBC_EventKey ICUAdmissionKey TransDt); run;
  data work._rob_measurements; set &measurements(keep=PersonKey RBC_EventKey VitalCode Datetime Value); run;

/* Average the measurements for each event and outcome within each window. For events
   with both means, subtract the pretransfusion mean from the posttransfusion mean. */
  proc sql noprint;
    create table work._rob_moments as select m.RBC_EventKey,m.VitalCode,count(*) as NOutcomeRecords,
      sum(-65 <= (m.Datetime-e.TransDt)/60 and (m.Datetime-e.TransDt)/60 <= -55) as NPreWindowRecords,
      sum(55 <= (m.Datetime-e.TransDt)/60 and (m.Datetime-e.TransDt)/60 <= 65) as NPostWindowRecords,
      sum(-65 <= (m.Datetime-e.TransDt)/60 and (m.Datetime-e.TransDt)/60 <= -55 and not missing(m.Value)) as NPreValues,
      sum(55 <= (m.Datetime-e.TransDt)/60 and (m.Datetime-e.TransDt)/60 <= 65 and not missing(m.Value)) as NPostValues,
      case when min(case when -65 <= (m.Datetime-e.TransDt)/60 and (m.Datetime-e.TransDt)/60 <= -55 then m.Value else . end)=max(case when -65 <= (m.Datetime-e.TransDt)/60 and (m.Datetime-e.TransDt)/60 <= -55 then m.Value else . end) then min(case when -65 <= (m.Datetime-e.TransDt)/60 and (m.Datetime-e.TransDt)/60 <= -55 then m.Value else . end)
        else mean(case when -65 <= (m.Datetime-e.TransDt)/60 and (m.Datetime-e.TransDt)/60 <= -55 then m.Value else . end) end as Pre_Avg,
      case when min(case when 55 <= (m.Datetime-e.TransDt)/60 and (m.Datetime-e.TransDt)/60 <= 65 then m.Value else . end)=max(case when 55 <= (m.Datetime-e.TransDt)/60 and (m.Datetime-e.TransDt)/60 <= 65 then m.Value else . end) then min(case when 55 <= (m.Datetime-e.TransDt)/60 and (m.Datetime-e.TransDt)/60 <= 65 then m.Value else . end)
        else mean(case when 55 <= (m.Datetime-e.TransDt)/60 and (m.Datetime-e.TransDt)/60 <= 65 then m.Value else . end) end as Post_Avg
      from work._rob_measurements m inner join work._rob_events e on m.RBC_EventKey=e.RBC_EventKey
      group by m.RBC_EventKey,m.VitalCode;
    create table work._rob_eventoutcomes as select e.PersonKey,e.RBC_EventKey,c.OutcomeOrder,c.VitalCode,c.Outcome,
      coalesce(m.NOutcomeRecords,0) as NOutcomeRecords,
      coalesce(m.NPreWindowRecords,0) as NPreWindowRecords,
      coalesce(m.NPostWindowRecords,0) as NPostWindowRecords,
      coalesce(m.NPreValues,0) as NPreValues,coalesce(m.NPostValues,0) as NPostValues,m.Pre_Avg,m.Post_Avg,
      (coalesce(m.NPreValues,0)>0) as PreAvailable,(coalesce(m.NPostValues,0)>0) as PostAvailable,
      (coalesce(m.NPreValues,0)>0 and coalesce(m.NPostValues,0)>0) as Paired,
      case when coalesce(m.NPreValues,0)>0 and coalesce(m.NPostValues,0)>0 then m.Post_Avg-m.Pre_Avg else . end as Diff
      from work._rob_events e cross join work._rob_codes c left join work._rob_moments m
        on e.RBC_EventKey=m.RBC_EventKey and c.VitalCode=m.VitalCode;
    create table work._rob_pairs as select a.*,g.Factor,g.CategoryCode
      from work._rob_eventoutcomes a inner join work._rob_groups g on a.RBC_EventKey=g.RBC_EventKey
      where g.Eligible=1;

/* Calculate the mean and SD over the paired events and count the contributing patients.
   MAIN identifies the whole cohort. */
    create table work._rob_summary as select c.OutcomeOrder,c.VitalCode,c.Outcome,l.Factor,l.CategoryCode,l.CategoryLabel,
      count(a.RBC_EventKey) as NEligibleEvents,
      count(distinct a.PersonKey) as NEligiblePatients,
      sum(case when a.PreAvailable=1 then 1 else 0 end) as NPreAvailableEvents,
      sum(case when a.PostAvailable=1 then 1 else 0 end) as NPostAvailableEvents,
      sum(case when a.Paired=1 then 1 else 0 end) as NDiff,
      count(distinct case when a.Paired=1 then a.PersonKey else . end) as NPairedPatients,
      sum(case when a.PreAvailable=1 and a.PostAvailable=0 then 1 else 0 end) as NPreOnlyEvents,
      sum(case when a.PreAvailable=0 and a.PostAvailable=1 then 1 else 0 end) as NPostOnlyEvents,
      sum(case when a.PreAvailable=0 and a.PostAvailable=0 then 1 else 0 end) as NNeitherAvailableEvents,
      sum(coalesce(a.NPreWindowRecords,0)) as NPreWindowRecords,
      sum(coalesce(a.NPostWindowRecords,0)) as NPostWindowRecords,
      sum(case when a.Paired=1 then a.NPreValues else 0 end) as NPairedPreValues,
      sum(case when a.Paired=1 then a.NPostValues else 0 end) as NPairedPostValues,
      case when min(case when a.Paired=1 then a.Pre_Avg else . end)=max(case when a.Paired=1 then a.Pre_Avg else . end) then min(case when a.Paired=1 then a.Pre_Avg else . end)
        else mean(case when a.Paired=1 then a.Pre_Avg else . end) end as Pre_Mean,
      std(case when a.Paired=1 then a.Pre_Avg else . end) as Pre_SD,
      case when min(case when a.Paired=1 then a.Post_Avg else . end)=max(case when a.Paired=1 then a.Post_Avg else . end) then min(case when a.Paired=1 then a.Post_Avg else . end)
        else mean(case when a.Paired=1 then a.Post_Avg else . end) end as Post_Mean,
      std(case when a.Paired=1 then a.Post_Avg else . end) as Post_SD,
      case when min(case when a.Paired=1 then a.Diff else . end)=max(case when a.Paired=1 then a.Diff else . end) then min(case when a.Paired=1 then a.Diff else . end)
        else mean(case when a.Paired=1 then a.Diff else . end) end as Diff_Mean,
      (min(case when a.Paired=1 then a.Diff else . end)=max(case when a.Paired=1 then a.Diff else . end)) as _ConstDiff,
      std(case when a.Paired=1 then a.Diff else . end) as Diff_SD,
      mean(case when a.Paired=1 then abs(a.Diff) else . end) as _MeanAbsDiff
      from work._rob_codes c cross join work._rob_levels l left join work._rob_pairs a
        on c.VitalCode=a.VitalCode and l.Factor=a.Factor and l.CategoryCode=a.CategoryCode
      group by c.OutcomeOrder,c.VitalCode,c.Outcome,l.Factor,l.CategoryCode,l.CategoryLabel;

/* Count the contributing patients and events for uncertainty estimation and choose a
   common scale for the event differences. */
      proc sql noprint;
        select CategoryCode into :cats separated by ' ' from work._rob_summary
          where VitalCode="&v" and Factor="&f" and NDiff>0 order by CategoryCode;
        %let k=&sqlobs;
        select count(*),count(distinct PersonKey) into :n trimmed,:g trimmed
          from work._rob_pairs where VitalCode="&v" and Factor="&f" and Paired=1;
        select put(case when max(Diff_SD)>0 then max(Diff_SD) else 1 end,hex16.)
          into :fit_scale_hex trimmed from work._rob_summary where VitalCode="&v" and Factor="&f";
        update work._rob_summary set FitPersons=&g,FitEvents=&n,FitCategories=&k
          where VitalCode="&v" and Factor="&f";
        update work._rob_pairwise set FitPersons=&g,FitEvents=&n,FitCategories=&k
          where VitalCode="&v" and Factor="&f";
      quit;

/* A variance estimate requires at least two contributing patients and more events than
   fitted categories. */
      %if &k>0 and &g>=2 and &n>&k %then %do;
        %let bad=0;
        %let fit_scale=input("&fit_scale_hex",hex16.);
        %if not %sysevalf(%sysfunc(inputn(&fit_scale_hex,hex16.))>0) %then %do;
          %rob_fail(INFERENCE_RESPONSE_SCALE_INVALID); %return;
        %end;
        %let modelvars=;
        %do j=1 %to &k; %let modelvars=&modelvars RBO&j; %end;

/* Centre and scale the event differences within categories before fitting. */
        proc sql noprint;
          create table work._rob_fit as select p.PersonKey,p.CategoryCode,
            (p.Diff-s.Diff_Mean)/&fit_scale as CenteredDiff
          from work._rob_pairs p inner join work._rob_summary s
            on p.VitalCode=s.VitalCode and p.Factor=s.Factor and p.CategoryCode=s.CategoryCode
          where p.VitalCode="&v" and p.Factor="&f" and p.Paired=1;
        quit;
        data work._rob_fit;
          set work._rob_fit;
          %do j=1 %to &k; RBO&j=(CategoryCode=%scan(&cats,&j)); %end;
          if missing(CenteredDiff) then call symputx('bad',1,'L');
          keep PersonKey CenteredDiff &modelvars;
        run;

/* Estimate category means using Taylor linearization with patient as the clustering
   unit. */
        ods output Estimates=work._rob_ods;
        proc surveyreg data=work._rob_fit varmethod=taylor alpha=0.05;
          cluster PersonKey;
          model CenteredDiff=&modelvars / noint solution vadjust=none;
          %do j=1 %to &k;
            estimate "W_&j" RBO&j 1 / cl;
            %do l=%eval(&j+1) %to &k;
              estimate "P_&j._&l" RBO&j 1 RBO&l -1 / cl;
            %end;
          %end;
        run;
        ods output close;

/* Read the degrees of freedom and confidence limits from the SURVEYREG Estimates table.
   The macro variables dfvar, lovar and hivar identify its column names. Check that the
   returned degrees of freedom equal the number of contributing patients minus one. */
        data work._rob_norm;
          length VitalCode $4 Factor $32 Kind $1 Label $32;
          set work._rob_ods(rename=(&dfvar=_DF &lovar=_Lower &hivar=_Upper Probt=_P));
          VitalCode="&v"; Factor="&f"; Kind=scan(Label,1,'_');
          _a=input(scan(Label,2,'_'),?? best32.); _b=input(scan(Label,3,'_'),?? best32.);
          CategoryA=input(scan("&cats",_a,' '),?? best32.);
          if Kind='P' then CategoryB=input(scan("&cats",_b,' '),?? best32.);
          else CategoryB=.;
          DF=_DF; Lower=_Lower; Upper=_Upper; PValue=_P;
          FitPersons=&g; FitEvents=&n; FitCategories=&k;
          Invalid=(missing(Estimate) or missing(StdErr) or StdErr<0 or DF ne &g-1
            or missing(CategoryA) or Kind not in ('P','W')
            or (Kind='P' and (missing(CategoryB) or CategoryA>=CategoryB))
            or (Kind='W' and not missing(_b)));

/* Restore means, standard errors and confidence limits to the recorded scale. */
        proc sql noprint;
          create table work._rob_restore as select i.*,a.Diff_Mean as _MeanA,b.Diff_Mean as _MeanB
          from work._rob_norm i inner join work._rob_summary a on i.VitalCode=a.VitalCode
            and i.Factor=a.Factor and i.CategoryA=a.CategoryCode
          left join work._rob_summary b on i.VitalCode=b.VitalCode
            and i.Factor=b.Factor and i.CategoryB=b.CategoryCode;
        quit;
        data work._rob_norm;
          set work._rob_restore;
          _Shift=_MeanA; if Kind='P' then _Shift=_MeanA-_MeanB;
          Estimate=Estimate*&fit_scale+_Shift; _ScaledSE=StdErr; StdErr=StdErr*&fit_scale;
          if not missing(Lower) then Lower=Lower*&fit_scale+_Shift;
          if not missing(Upper) then Upper=Upper*&fit_scale+_Shift;
          if StdErr>0 then PValue=2*probt(-abs(Estimate/StdErr),DF);
          else PValue=.;

/* Add the estimates from _rob_norm to the accumulated inference table on their recorded
   scale. */
        proc append base=work._rob_inference data=work._rob_norm(drop=Invalid) force; run;

/* Join each observed mean change to its patient-clustered uncertainty. */
    create table work._rob_joined as select s.*,i.StdErr as _SE,i.DF as _DF,
      i.Lower as _Lower,i.Upper as _Upper,i.PValue as _P
      from work._rob_summary s left join work._rob_inference i
        on s.VitalCode=i.VitalCode and s.Factor=i.Factor and s.CategoryCode=i.CategoryA and i.Kind='W';

/* Assign the standard error and interval for the paired mean change. */
  data work._rob_summary;
    set work._rob_joined;
    if _ConstDiff and NDiff>0 and not missing(_SE) then _SE=0;
    if not missing(_SE) and NPairedPatients>=2 then do;
      if _SE>0 then do;
        Diff_SE=_SE; DF=_DF; Diff_LCL=_Lower; Diff_UCL=_Upper; PValue=_P;

/* Table 2 uses the MAIN rows. */
  data work._rob_main; set work._rob_summary; drop _:; where Factor='MAIN'; run;
