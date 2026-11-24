/* Descriptive LOESS curves for the primary cohort. These use the available measurements
   of eligible events. Repeated records of simultaneous units are retained here. Each
   retained time-group mean receives equal weight in the local quadratic fit. */
/* Each labelled excerpt may begin or end within a SAS step. */

/* Include eligible source measurements outside the model window when estimating the
   mean and SD used for standardization. */
 data work._rps_lpsrc;
   length SourceWindowStatus $24;
   set work._rps_index(in=inside keep=PersonKey ClinicalPatientID TransDt Datetime VitalCode Value StoredAdmissionTime StoredDischargeTime)
       work._rps_irbad(in=outside where=(ReasonCode='OUTSIDE_ANALYSIS_WINDOW')
         keep=PersonKey ClinicalPatientID TransDt Datetime VitalCode Value StoredAdmissionTime StoredDischargeTime ReasonCode);
   if inside then SourceWindowStatus='IN_ANALYSIS_WINDOW';
   else SourceWindowStatus='WINDOW_ONLY_EXCLUDED';
 run;

/* Match the observed measurements to the eligible event and its admission. */
 proc sql;
   create table work._rps_loess_prewindow as
   select i.PersonKey,i.ClinicalPatientID,e.RBC_EventKey,e.ICUAdmissionKey,
     i.TransDt,i.Datetime,(i.Datetime-i.TransDt)/60 as TimeFromTransfusion,
     i.VitalCode,i.Value,e.AdmissionTime,e.DischargeTime,i.SourceWindowStatus
   from work._rps_lpsrc i inner join work._rps_events e
     on i.PersonKey=e.PersonKey and i.TransDt=e.TransDt
     and i.ClinicalPatientID=e.ClinicalPatientID
     and not missing(i.StoredAdmissionTime) and not missing(i.StoredDischargeTime)
     and i.StoredAdmissionTime=e.AdmissionTime and i.StoredDischargeTime=e.DischargeTime;
 quit;

/* Compute the measurement-level mean and SD separately for each outcome, then
   standardize each measurement. */
 data work._llplan;
  length VitalCode $4;
  do PlotOrder=1 to 7; VitalCode=scan('ARTm ARTs ARTd HR FIO2 SPO2 VE',PlotOrder); output; end;
 run;
 proc sort data=&preparedlib..loess_prewindow(keep=VitalCode Value TimeFromTransfusion PersonKey RBC_EventKey) out=work._llsrc;
  by VitalCode;
 run;
 proc means data=work._llsrc noprint; by VitalCode; var Value;
  output out=work._llone n=NAvailable mean=GlobalMean std=GlobalStd;
 run;
 proc sql;
  create table work._llscale as select p.*,s.NAvailable,s.GlobalMean,s.GlobalStd from work._llplan p
   left join work._llone s on p.VitalCode=s.VitalCode order by p.VitalCode;
 quit;
 data work._llscale;
  length ScaleStatus $48;
  set work._llscale;
  if missing(NAvailable) then NAvailable=0;
  if NAvailable=0 then ScaleStatus='UNAVAILABLE_NO_INPUT';
  else if missing(GlobalMean) or missing(GlobalStd) or GlobalStd<=0 or abs(GlobalMean)>constant('BIG') or GlobalStd>constant('BIG')
   then ScaleStatus='UNAVAILABLE_ZERO_OR_UNDEFINED_SCALE';
  else ScaleStatus='AVAILABLE';
 run;
 data work._llz;
  merge work._llsrc(in=a) work._llscale; by VitalCode; if a;
  Value_Z=.; if ScaleStatus='AVAILABLE' and not missing(Value) then Value_Z=(Value-GlobalMean)/GlobalStd;
  if ScaleStatus='AVAILABLE' and not missing(Value) and (missing(Value_Z) or abs(Value_Z)>constant('BIG')) then call symputx('bad',1,'L');
 run;

/* Average at each exact relative time and keep the 12 hours on either side of
   transfusion. Above 50,000 time groups, sample with a fixed seed before keeping every
   third group in each outcome. */
 proc sort data=work._llz; by VitalCode TimeFromTransfusion; run;
 proc means data=work._llz noprint; by VitalCode TimeFromTransfusion; var Value_Z Value;
  output out=work._lltgroups mean=Z_Mean RawMean;
 run;
 data work._llwindow;
  set work._lltgroups;
  if -720<=TimeFromTransfusion and TimeFromTransfusion<=720;
  PlotOrder=findw('ARTm ARTs ARTd HR FIO2 SPO2 VE',strip(VitalCode),' ','E');
 run;
 proc sort data=work._llwindow; by PlotOrder TimeFromTransfusion; run;
 proc sql noprint; select count(*) into :total trimmed from work._llwindow; quit;
 %let fraction=1; %if &total>50000 %then %let fraction=%sysevalf(50000/&total);
 data work._llbern;
  set work._llwindow;
  if &total>50000 then do; if ranuni(1234)<&fraction then output; end;
  else output;
 run;
 data work._llret;
  set work._llbern; by PlotOrder TimeFromTransfusion;
  if first.PlotOrder then counter=0; counter+1;
  if mod(counter,3)=0 then output; drop counter;
 run;
 proc sort data=work._llret; by VitalCode TimeFromTransfusion; run;
 proc sql;
  create table work._llstatus as select s.*,coalesce(t.NFit,0) as NFit from work._llscale s
   left join (select VitalCode,count(*) as NFit from work._llret where not missing(Z_Mean) group by VitalCode) t
   on s.VitalCode=t.VitalCode;
 quit;

/* Each local quadratic fit requires at least three time points in its smoothing
   neighbourhood. */
  do SpanPercent=10 to 90;
   if ScaleStatus ne 'AVAILABLE' then FitStatus=ScaleStatus;
   else if NFit*SpanPercent<300 then FitStatus='INSUFFICIENT_SUPPORT';
   else FitStatus='DIRECT_COMPLETED';
   output;
  end;
 run;
 proc sql;
  create table work._llfit as select t.* from work._llret t inner join work._llstatus s on t.VitalCode=s.VitalCode
   and s.SpanPercent=90 and s.FitStatus='DIRECT_COMPLETED' where not missing(t.Z_Mean) order by t.VitalCode,t.TimeFromTransfusion;
 quit;

/* Use the common set of smoothing spans where the smallest span is supported. */
 proc sql;
  create table work._llfastfit as select t.* from work._llfit t inner join work._llstatus s
   on t.VitalCode=s.VitalCode and s.SpanPercent=10 and s.FitStatus='DIRECT_COMPLETED'
   order by t.VitalCode,t.TimeFromTransfusion;
 quit;

/* The spans range from 0.10 to 0.90 in steps of 0.01. */
%macro rbl_spans;
 %local s; %do s=10 %to 90; %sysevalf(&s/100) %end;
%mend;

/* Fit the local quadratic without additional robustness iterations. */
  proc loess data=work._llfastfit;
   by VitalCode;
   model Z_Mean=TimeFromTransfusion / smooth=(%rbl_spans) degree=2 alpha=.05 direct all iterations=1 scale=none;
   output out=work._lldirect p=Pred lclm=Lower uclm=Upper;
  run;

/* For sparser outcomes, fit only the supported spans. */
  proc sql noprint;
   select (SpanPercent/100) format=4.2 into :smoothlist separated by ' '
    from work._llstatus where VitalCode="&sparse_code" and NFit<30 and FitStatus='DIRECT_COMPLETED'
    order by SpanPercent;
  quit;
  %if %length(%superq(smoothlist))>0 %then %do;
   ods listing; ods exclude all;
   proc loess data=work._llfit(where=(VitalCode="&sparse_code"));
    by VitalCode;
    model Z_Mean=TimeFromTransfusion / smooth=(&smoothlist) degree=2 alpha=.05 direct all iterations=1 scale=none;
    output out=work._llpart p=Pred lclm=Lower uclm=Upper;
   run;

/* Find the fitted values bracketing each minute from minus 720 through plus 720 for
   this outcome and span. */
 data &b;
  set &points(keep=VitalCode SpanPercent TimeFromTransfusion Z_Mean Pred);
  if not missing(Z_Mean);
  _Kind=0; GridPointId=.;
  keep VitalCode SpanPercent TimeFromTransfusion Pred _Kind GridPointId;
 run;
 data &c;
  set &a;
  _Kind=1; Pred=.;
  do SpanPercent=&span_min to &span_max;
   do GridPointId=1 to %eval((&grid_max-&grid_min)/&grid_step+1);
    TimeFromTransfusion=&grid_min+(GridPointId-1)*&grid_step; output;
   end;
  end;
  keep VitalCode SpanPercent TimeFromTransfusion Pred _Kind GridPointId;
 run;
 data &d; set &b &c; run;
 proc sort data=&d; by VitalCode SpanPercent TimeFromTransfusion _Kind; run;
 data &e;
  set &d; by VitalCode SpanPercent TimeFromTransfusion _Kind;
  retain LeftX LeftY HasLeft;
  if first.SpanPercent then do; call missing(LeftX,LeftY); HasLeft=0; end;
  if _Kind=0 then do; LeftX=TimeFromTransfusion; LeftY=Pred; HasLeft=1; end;
  else output;
  keep VitalCode SpanPercent TimeFromTransfusion GridPointId LeftX LeftY HasLeft;
 run;
 proc sort data=&d; by VitalCode SpanPercent descending TimeFromTransfusion _Kind; run;
 data &f;
  set &d; by VitalCode SpanPercent descending TimeFromTransfusion _Kind;
  retain RightX RightY HasRight;
  if first.SpanPercent then do; call missing(RightX,RightY); HasRight=0; end;
  if _Kind=0 then do; RightX=TimeFromTransfusion; RightY=Pred; HasRight=1; end;
  else output;
  keep VitalCode SpanPercent TimeFromTransfusion GridPointId RightX RightY HasRight;
 run;
 proc sort data=&f; by VitalCode SpanPercent TimeFromTransfusion GridPointId; run;

/* Interpolate within the retained range and leave estimates outside it unavailable. */
 data &g;
  merge &e &f; by VitalCode SpanPercent TimeFromTransfusion GridPointId;
  length PointStatus $40 SupportStatus $40;
  Estimate=.;
  if HasLeft=0 and HasRight=0 then do;
   PointStatus='UNAVAILABLE_NO_RETAINED_INPUT'; SupportStatus='NO_RETAINED_INPUT';
  end;
  else if HasLeft=0 or HasRight=0 then do;
   PointStatus='OUTSIDE_RETAINED_SUPPORT'; SupportStatus='OUTSIDE_RETAINED_SUPPORT';
  end;
  else do;
   SupportStatus='WITHIN_RETAINED_RANGE';
   if missing(LeftY) or missing(RightY) then PointStatus='FIT_UNAVAILABLE';
   else if LeftX=TimeFromTransfusion and RightX=TimeFromTransfusion then do;
    if LeftY ne RightY then PointStatus='FIT_UNAVAILABLE';
    else do; Estimate=LeftY; PointStatus='AVAILABLE_EXACT_KNOT'; end;
   end;
   else if LeftX<TimeFromTransfusion and TimeFromTransfusion<RightX then do;
    _Fraction=(TimeFromTransfusion-LeftX)/(RightX-LeftX);
    Estimate=(1-_Fraction)*LeftY+_Fraction*RightY;
    if missing(Estimate) then PointStatus='FIT_UNAVAILABLE';
    else PointStatus='AVAILABLE_LINEAR_FROM_DIRECT';
   end;
   else PointStatus='FIT_UNAVAILABLE';
  end;
  keep VitalCode SpanPercent TimeFromTransfusion GridPointId Estimate PointStatus SupportStatus;
 run;
 proc sql;
  create table &h as select g.*,s.GlobalMean,s.GlobalStd,u.Unit as NativeUnit,u.UnitStatus
   from &g g inner join &scaling s on g.VitalCode=s.VitalCode
   inner join &units u on g.VitalCode=u.VitalCode;
 quit;

/* Return the standardized estimate and its equivalent on the recorded scale. */
  ValueScale='Z_SCORE'; Unit='SD'; output;
  ValueScale='NATIVE'; Unit=NativeUnit;
  if not missing(Estimate) then do;
   Estimate=GlobalMean+GlobalStd*Estimate;
   if missing(Estimate) then PointStatus='NATIVE_TRANSFORM_UNAVAILABLE';
  end;
  output;
