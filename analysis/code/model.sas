/* Mixed models. The input &data contains canonical_long measurements from the selected
   cohort. The model selects one outcome and applies its own covariate requirements.
   Each prediction uses the same reference profile throughout follow-up. The weekday
   programs describe any subsequent fixed-covariance recalculation of the coefficients. */
/* Each labelled excerpt may begin or end within a SAS step. */

/* Define the time and covariate splines. Discover covariate knots on the measurement
   rows, then reuse the knot values when constructing the prediction design. */
%macro rbc_native_effects(adjustment=FULL,knots=,details=,basis=NATURALCUBIC);
    %local variables effects k variable effect handle rc number value knotlist basis_option;
    %let basis_option=naturalcubic;
    %if %upcase(&basis)=TPF %then %let basis_option=basis=tpf;
    %else %if %upcase(&basis) ne NATURALCUBIC %then %rbc_fit_fail(Unsupported native spline basis request.);
    %let variables=TimeFromTransfusion PatientAge ICU_time;
    %let effects=spl_time spl_age spl_icu;
    %if %upcase(&adjustment)=FULL %then %do;
        %let variables=&variables Crystalloid_1 Crystalloid_24 Pressors_1 Pressors_24;
        %let effects=&effects spl_cryst1 spl_cryst24 spl_press1 spl_press24;
    %end;
    %do k=1 %to %sysfunc(countw(&variables));
        %let variable=%scan(&variables,&k);
        %let effect=%scan(&effects,&k);
        %if %length(%superq(knots))=0 %then %do;
            %if &k=1 %then %do;
                effect &effect=spline(&variable / &basis_option &details
                    knotmethod=list(-660 -360 -60 0 60 360 660));
            %end;
            %else %do;
                effect &effect=spline(&variable / &basis_option &details knotmethod=percentiles(3));
            %end;
        %end;
        %else %do;
            %let knotlist=;
            %let handle=%sysfunc(open(&knots(where=(VariableName="&variable")),i));
            %if &handle=0 %then %rbc_fit_fail(Frozen spline-knot archive cannot be opened.);
            %let number=%sysfunc(varnum(&handle,KnotValue));
            %if &number=0 %then %rbc_fit_fail(Frozen spline-knot schema is invalid.);
            %let rc=%sysfunc(fetch(&handle));
            %do %while(&rc=0);
                %let value=%sysfunc(getvarn(&handle,&number),best32.);
                %let knotlist=&knotlist &value;
                %let rc=%sysfunc(fetch(&handle));
            %end;
            %let rc=%sysfunc(close(&handle));
            %if (&k=1 and %sysfunc(countw(&knotlist,%str( ))) ne 7) or
                (&k>1 and %sysfunc(countw(&knotlist,%str( ))) ne 3) %then
                %rbc_fit_fail(Frozen spline archive has the wrong native knot count.);
            effect &effect=spline(&variable / &basis_option &details knotmethod=list(&knotlist));
        %end;
    %end;
%mend;

/* Obtain the knot coordinates from the complete observations for this model. */
    ods output SplineKnots=&outlib..&job_id._knots_native;
    proc glimmix data=work._rbc_real nofit;
        %rbc_native_effects(adjustment=&adjustment,details=details,basis=TPF);
        model Value=spl_time spl_age spl_icu
            %if %upcase(&adjustment)=FULL %then %do;
                spl_cryst1 spl_cryst24 spl_press1 spl_press24
            %end;
            / dist=normal link=identity;
    run;

/* Record the knot values by variable and retain their order within each spline. */
    data &outlib..&job_id._knots;
        set &outlib..&job_id._knots_native;
        length EffectName VariableName $32 Basis $16 KnotSource $32 BoundaryRole $8;
        EffectName=strip(ConstructedEffect); Basis='NATURALCUBIC';
        KnotSource='REAL_COMPLETE_CASE_NATIVE_SAS';
        select (upcase(EffectName));
            when ('SPL_TIME') do; VariableName='TimeFromTransfusion'; KnotValue=TimeFromTransfusion; ExpectedKnots=7; KnotSource='FIXED_TIME_SPECIFICATION'; end;
            when ('SPL_AGE') do; VariableName='PatientAge'; KnotValue=PatientAge; ExpectedKnots=3; end;
            when ('SPL_ICU') do; VariableName='ICU_time'; KnotValue=ICU_time; ExpectedKnots=3; end;
            %if %upcase(&adjustment)=FULL %then %do;
                when ('SPL_CRYST1') do; VariableName='Crystalloid_1'; KnotValue=Crystalloid_1; ExpectedKnots=3; end;
                when ('SPL_CRYST24') do; VariableName='Crystalloid_24'; KnotValue=Crystalloid_24; ExpectedKnots=3; end;
                when ('SPL_PRESS1') do; VariableName='Pressors_1'; KnotValue=Pressors_1; ExpectedKnots=3; end;
                when ('SPL_PRESS24') do; VariableName='Pressors_24'; KnotValue=Pressors_24; ExpectedKnots=3; end;
            %end;
            otherwise do;
                put 'ERROR: RBC_FIT_GUARD: Native spline-knot effect mapping is unsupported.';
                abort cancel;
            end;
        end;
        BoundaryRole='INTERNAL';
        if KnotNumber=1 then BoundaryRole='LOWER';
        if KnotNumber=ExpectedKnots then BoundaryRole='UPPER';
        keep EffectName VariableName Basis KnotSource BoundaryRole KnotNumber KnotValue ExpectedKnots;
        format KnotValue best32.;
    run;

/* Fixed effects for BASE and FULL. A model for a blood unit characteristic includes the
   category and its interaction with time. */
%macro rbc_native_terms(factor=NONE,adjustment=FULL);
    %if %upcase(&factor)=NONE %then %do; spl_time %end;
    %else %do; spl_time | &factor %end;
    spl_age spl_icu RBC_Count PatientSex WardName
    %if %upcase(&adjustment)=FULL %then %do;
        spl_cryst1 spl_cryst24 spl_press1 spl_press24
        Sedatives_1_bin Sedatives_24_bin
    %end;
%mend;

/* Set the two target minutes for the primary contrast. */
    %let adjust=%upcase(&adjustment);
    %let factor_none=0;
    %if %upcase(&factor)=NONE %then %let factor_none=1;
    %let before_time=-60;
    %let after_time=60;

/* List the numeric fields required by this outcome, characteristic and adjustment
   model. */
    %let required_num=PatientID Value TimeFromTransfusion PatientAge RBC_Count ICU_time;
    %if &cohort_mode ne synthetic %then %rbc_fit_require(data=&data,variables=PersonKey,kind=N);
    %if &adjust=FULL %then
        %let required_num=&required_num Crystalloid_1 Crystalloid_24 Pressors_1 Pressors_24 Sedatives_1_bin Sedatives_24_bin;
    %if &factor_none=0 %then %let required_num=&required_num &factor;
    %if %upcase(&factor)=DONORPARITY_FEMALE %then
        %let required_num=&required_num DonorSex;

/* Create _rbc_scope from the cohort measurement records for the selected outcome. */
    data work._rbc_scope;
        length VitalCode $16;
        set &data(rename=(VitalCode=_RBC_INPUT_VITALCODE));
        where upcase(_RBC_INPUT_VITALCODE)=upcase("&vital");
        VitalCode="&vital";
        drop _RBC_INPUT_VITALCODE;

/* Keep observations within the time window and apply the characteristic-specific
   restrictions. */
        if missing(TimeFromTransfusion) then delete;
        if TimeFromTransfusion < -720 or TimeFromTransfusion > 720 then delete;
        %if &factor_none=1 %then %do; RBC_Category=1; %end;
        %else %do;
            if not missing(&factor) and &factor not in (&planned_codes) then do;
                put 'ERROR: RBC_FIT_GUARD: Unknown nonmissing planned category code.';
                abort cancel;
            end;
            RBC_Category=&factor;
        %end;
        %if %upcase(&factor)=DONORPARITY_FEMALE %then %do;
            if DonorSex ne 2 then delete;
            if DonorParity_Female not in (0,1) then delete;
        %end;
    run;

/* Retain complete measurement records for this model, using the recorded levels for sex
   and ward. */
    data work._rbc_real;
        length RBC_Source $5;
        set work._rbc_scope;
        if nmiss(of &required_num)>0 then delete;
        if missing(RBC_EventKey) or missing(PatientSex) or missing(WardName) then delete;
        RBC_Source='REAL';
        %if &factor_none=1 %then %do; RBC_Category=1; %end;
        %else %do; RBC_Category=&factor; %end;
    run;

/* Enumerate the categories present in the complete observations. */
    proc sql;
        create table work._rbc_categories as
        select RBC_Category as CategoryCode, count(*) as N_Observations,
               count(distinct PatientID) as N_Patients,
               count(distinct RBC_EventKey) as N_Events
        from work._rbc_real group by RBC_Category order by RBC_Category;
    quit;
    data &outlib..&job_id._categories;
        set work._rbc_categories;
        CategoryIndex=_n_;
    run;
    proc sql noprint;
        select count(*) into :n_categories trimmed from &outlib..&job_id._categories;
    quit;

/* Construct the reference profile and one prediction row per minute and category. The
   means of the positive-treatment indicators are the proportions of observations with
   positive summaries. */
    %rbc_fit_freeze_knots(outlib=&outlib,job_id=&job_id,adjustment=&adjust);

    proc means data=work._rbc_real noprint;
        var PatientAge ICU_time RBC_Count
            %if &adjust=FULL %then %do;
                Crystalloid_1 Crystalloid_24 Pressors_1 Pressors_24
                Sedatives_1_bin Sedatives_24_bin
            %end;
        ;
        output out=work._rbc_means(drop=_type_ _freq_) mean=;
    run;
    proc freq data=work._rbc_real order=freq noprint;
        tables WardName / out=work._rbc_ward;
    run;
    data &outlib..&job_id._profile;
        length PatientSex $1;
        if _n_=1 then set work._rbc_ward(obs=1 keep=WardName);
        set work._rbc_means;
        PatientSex='M';
    run;
    data work._rbc_score;
        length RBC_Source $5 RBC_EventKey $80 VitalCode $16;
        if _n_=1 then set &outlib..&job_id._profile;
        set &outlib..&job_id._categories(keep=CategoryIndex CategoryCode);
        RBC_Source='SCORE'; RBC_EventKey='SCORING_ONLY'; VitalCode="&vital";
        PatientID=&score_subject; Value=.; RBC_Category=CategoryCode;
        %if &factor_none=0 %then %do; &factor=CategoryCode; %end;
        do TimeFromTransfusion=-720 to 720;
            GridID=(CategoryIndex-1)*1441+TimeFromTransfusion+721;
            output;
        end;
    run;

/* Combine observations and prediction rows to use a common design. */
    data work._rbc_both;
        set work._rbc_real work._rbc_score;
        RBC_DesignRow=_n_;
    run;

/* Build the fixed-effects design with the previously determined knots. */
    proc glimmix data=work._rbc_both nofit
        outdesign(x=RBCX names)=work._rbc_design;
        class PatientSex WardName %if &factor_none=0 %then &factor; ;
        %rbc_native_effects(adjustment=&adjust,knots=&outlib..&job_id._knots);
        model Value=%rbc_native_terms(factor=&factor,adjustment=&adjust)
            / dist=normal link=identity;
    run;

/* Order the design columns consistently for the fit and all predictions. */
    proc sql;
        create table &outlib..&job_id._columns as
        select name as ColumnName length=32,label as ParameterLabel length=256,
               varnum as InputPosition,type as VariableType,
               input(substr(name,5),best32.) as ColumnIndex
        from work._rbc_columns
        where prxmatch('/^RBCX[0-9]+$/i',strip(name))>0
        order by calculated ColumnIndex;
    quit;
    proc sql noprint;
        select count(*),count(distinct ColumnIndex),min(ColumnIndex),max(ColumnIndex),
               sum(VariableType ne 1)
        into :n_columns trimmed,:coefficient_count trimmed,:i trimmed,:member trimmed,:bad trimmed
        from &outlib..&job_id._columns;
        select ColumnName into :xvars separated by ' '
        from &outlib..&job_id._columns order by ColumnIndex;
    quit;

/* Scale each design column by the larger of one and its maximum absolute value among
   observations. Apply that same scale to observations and prediction rows. */
    data &outlib..&job_id._column_scale;
        array X{&n_columns} &xvars;
        array Scale{&n_columns} _temporary_;
        do until(Last);
            set work._rbc_design(where=(RBC_Source='REAL')) end=Last;
            do j=1 to dim(X); Scale{j}=max(Scale{j},abs(X{j})); end;
        end;
        do j=1 to dim(X); X{j}=max(1,Scale{j}); end;
        keep &xvars;
        format &xvars best32.;
    run;
    data work._rbc_design;
        array X{&n_columns} &xvars;
        array Scale{&n_columns} _temporary_;
        if _n_=1 then do;
            set &outlib..&job_id._column_scale;
            do j=1 to dim(X); Scale{j}=X{j}; end;
        end;
        set work._rbc_design;
        do j=1 to dim(X); X{j}=X{j}/Scale{j}; end;
        drop j;
    run;

/* Retain the scaled prediction design for contrasts and uncertainty estimates. */
    data &outlib..&job_id._score_design;
        set work._rbc_design;
        if RBC_Source='SCORE';
        keep GridID CategoryIndex CategoryCode TimeFromTransfusion &xvars;
    run;

/* Select the two endpoints and seven knots on each prediction grid. */
    proc sort data=&outlib..&job_id._score_design;
        by CategoryIndex TimeFromTransfusion;
    run;
    data &outlib..&job_id._anchor_design;
        set &outlib..&job_id._score_design;
        if TimeFromTransfusion in (-720,-660,-360,-60,0,60,360,660,720);
        AnchorID+1;
    run;

/* Form the category changes and the first-minus-second differences in those changes by
   subtracting the appropriate rows of the design. */
    data work._rbc_requests;
        length Label $20 RequestType $12;
        array X{&n_columns} &xvars;
        array AnchorX{&n_anchors,&n_columns} _temporary_;
        array Cat{&n_anchors} _temporary_;
        array AtTime{&n_anchors} _temporary_;
        array Before{&n_categories} _temporary_;
        array After{&n_categories} _temporary_;
        do a=1 to &n_anchors;
            set &outlib..&job_id._anchor_design point=a;
            Cat{a}=CategoryIndex; AtTime{a}=TimeFromTransfusion;
            do j=1 to &n_columns; AnchorX{a,j}=X{j}; end;
            if TimeFromTransfusion=&before_time then Before{CategoryIndex}=a;
            if TimeFromTransfusion=&after_time then After{CategoryIndex}=a;
        end;
        do a=1 to &n_anchors;
            Label=cats('A',put(a,z3.)); RequestType='ANCHOR';
            AnchorA=a; AnchorB=.; CategoryA=Cat{a}; CategoryB=.;
            do j=1 to &n_columns; X{j}=AnchorX{a,j}; end;
            output;
            do b=a+1 to &n_anchors;
                Label=cats('AD',put(a,z3.),'_',put(b,z3.)); RequestType='ANCHOR_DIFF';
                AnchorA=a; AnchorB=b; CategoryA=Cat{a}; CategoryB=Cat{b};
                do j=1 to &n_columns; X{j}=AnchorX{a,j}-AnchorX{b,j}; end;
                output;
            end;
        end;
        do c=1 to &n_categories;
            if missing(Before{c}) or missing(After{c}) then do;
                put 'ERROR: RBC_FIT_GUARD: endpoint anchors are missing.';
                abort cancel;
            end;
            Label=cats('W',put(c,z3.)); RequestType='WITHIN';
            AnchorA=After{c}; AnchorB=Before{c}; CategoryA=c; CategoryB=.;
            do j=1 to &n_columns; X{j}=AnchorX{After{c},j}-AnchorX{Before{c},j}; end;
            output;
            do d=c+1 to &n_categories;
                Label=cats('P',put(c,z3.),'_',put(d,z3.)); RequestType='PAIRWISE';
                AnchorA=.; AnchorB=.; CategoryA=c; CategoryB=d;
                do j=1 to &n_columns;
                    X{j}=AnchorX{After{c},j}-AnchorX{Before{c},j}
                        -AnchorX{After{d},j}+AnchorX{Before{d},j};
                end;
                output;
            end;
        end;
        stop;
        keep Label RequestType AnchorA AnchorB CategoryA CategoryB &xvars;
    run;

/* Fit the patient random-intercept model by restricted maximum likelihood. The file
   rbcest contains ESTIMATE statements generated from the contrast rows above.
   Predictions use the fixed effects. See covariance.sas for their patient-clustered
   uncertainty. */
    proc hpmixed data=work._rbc_design method=reml noclprint itdetails;
        nloptions tech=newrap gconv=1e-10 absgconv=1e-8 fconv=0 absfconv=0 maxiter=200
            %if %length(%superq(starts))>0 %then %do; maxfunc=125 %end; ;
        class PatientID;
        model Value=&xvars / noint solution ddfm=residual;
        random intercept / subject=PatientID;
        %if %length(%superq(starts))>0 %then %do;
            parms / parmsdata=&starts;
        %end;
        %include rbcest;
        output out=work._rbc_&attempt._predictions pred(noblup)=Predicted
            stderr(noblup)=StdErr lcl(noblup)=Lower ucl(noblup)=Upper;
    run;

/* The optimizer can restart once after a specific failure to improve the objective. */
        _RBC_ReasonTokens=prxchange('s/[^A-Z]+/ /',-1,upcase(Reason));
        RestartEligible=(Status=1 and findw(_RBC_ReasonTokens,'OPTIMIZATION',' ')>0
            and (findw(_RBC_ReasonTokens,'NOT',' ')>0 or findw(_RBC_ReasonTokens,'CANNOT',' ')>0)
            and findw(_RBC_ReasonTokens,'IMPROVE',' ')>0
            and findw(_RBC_ReasonTokens,'FUNCTION',' ')>0
            and findw(_RBC_ReasonTokens,'HESSIAN',' ')=0
            and findw(_RBC_ReasonTokens,'ITERATION',' ')=0
            and findw(_RBC_ReasonTokens,'GCONV',' ')=0
            and findw(_RBC_ReasonTokens,'FCONV',' ')=0);
        if RestartEligible then TriggerClass='FUNCTION_IMPROVEMENT_STALL';
        else if Status ne 0 then TriggerClass='UNRECOGNIZED_NONCONVERGENCE';
        call symputx('retry_eligible',RestartEligible,'L');

/* The restart uses the preceding variance-component estimates as its starting values. */
        data &outlib..&job_id._restart_starts;
            if _n_=1 then set &outlib..&job_id._identity;
            set &outlib..&job_id._p_covparms(keep=CovParm Subject Estimate);
            StartOrder=_n_;
        run;
        %rbc_fit_optimizer_attempt(outlib=&outlib,job_id=&job_id,attempt=r,
            xvars=&xvars,n_categories=&n_categories,starts=&outlib..&job_id._restart_starts);

/* Retain predictions from the selected optimizer attempt: p denotes the initial fit and
   r the permitted restart. */
    data work._rbc_predictions;
        set work._rbc_&selected._predictions;
    run;

/* Select the prediction rows for the trajectories. */
    data work._rbc_curve;
        set work._rbc_predictions;
        if RBC_Source='SCORE';
        if nmiss(Predicted,StdErr,Lower,Upper)>0 or StdErr<0 or Lower>Predicted or Predicted>Upper then do;
            put 'ERROR: RBC_FIT_GUARD: missing or invalid prediction interval.';
            abort cancel;
        end;
        keep GridID CategoryIndex CategoryCode TimeFromTransfusion Predicted StdErr Lower Upper;
    run;

/* Subtract the prediction at minus 60 minutes within the same category. The two-hour
   endpoint is evaluated at plus 60 minutes. See weekday.sas for the separate weekday
   calculations. */
    proc sql;
        create table &outlib..&job_id._trajectory as
        select "&job_id" as JobID length=12,"&vital" as VitalCode length=16,
               "&factor" as FactorName length=32,"&adjust" as Model length=4,
               a.*,a.Predicted-b.Predicted as Delta,&before_time as BaselineMinute
        from work._rbc_curve a left join work._rbc_curve b
        on a.CategoryIndex=b.CategoryIndex and b.TimeFromTransfusion=&before_time
        order by a.CategoryIndex,a.TimeFromTransfusion;
        create table work._rbc_endpoint_check as
        select w.CategoryA,w.Estimate,w.StdErr,
               post.Predicted-pre.Predicted as CurveChange
        from &outlib..&job_id._within_changes w
        left join work._rbc_curve pre on w.CategoryA=pre.CategoryIndex
            and pre.TimeFromTransfusion=&before_time
        left join work._rbc_curve post on w.CategoryA=post.CategoryIndex
            and post.TimeFromTransfusion=&after_time;
    quit;
