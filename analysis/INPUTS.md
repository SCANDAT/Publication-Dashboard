# Input tables

Three source tables supply measurements, transfused units and ICU admission histories. They share person identifiers and a common time basis. The sensitivity analysis also uses a coverage table with the dates covered by the transfusion extract for each person.

Measurements were linked to candidate transfusion starts during extraction. Hospital and ward selection, index dates and treatment histories were also defined upstream. The study reports events from 1 January 2014 through 17 November 2018. The preparation code checks the linked admissions, events and measurement times. Recorded ages confirmed that all 4,815 patients in the primary cohort were adults. Cohort preparation applied no additional age restriction.

## Measurements and index transfusions

| Variables | SAS type | Use |
| --- | --- | --- |
| `StudyID`, `PatientID` | Numeric | Person and recorded clinical/admission identifiers. The admission history resolves their relationship. |
| `TransDt`, `Datetime` | Numeric | Transfusion start and measurement time, in SAS datetime units. |
| `Value` | Numeric | Recorded outcome value. The study applied no additional physiological artifact thresholds. |
| `AdmissionTime`, `DischargeTime` | Numeric | Recorded admission boundaries as SAS datetimes. |
| `Age` | Numeric | Recipient age. |
| `Sex`, `WardName`, `Abbreviation` | Character | Recipient sex, ward and outcome channel. |
| `SAPS_3` | Character | Recorded severity score. The descriptive analysis parses the field and distinguishes nonnumeric entries from missing values. |
| `Crystalloid_1`, `Crystalloid_24`, `Pressors_1`, `Pressors_24` | Numeric | Crystalloid and noradrenaline summaries for 1 and 24 hours, precomputed in the supplied extract. |
| `Sedatives_1`, `Sedatives_24` | Numeric | Sedative/analgesic summaries for 1 and 24 hours, precomputed in the supplied extract and used to derive indicators. |

Treatment windows end at each measurement and can include care given after transfusion start. A positive sedative/analgesic summary defines each indicator. Missing values remain missing. The extraction documentation gives limited information about dose units, calculation rules and any zero filling in the source system.

The study reports the fraction of inspired oxygen as a percentage and minute ventilation in litres per minute. The reported change in an oxygen percentage is expressed in percentage points. The analysis uses the recorded numerical scales without rescaling. The available channel documentation does not establish how inspired oxygen was recorded, which ventilation modes were used, or whether units were uniform across wards and periods. The preparation code supplies the channel mapping. [Cohort preparation](code/cohort.sas)

## Transfused red cell units

| Variables | SAS type | Use |
| --- | --- | --- |
| `StudyID`, `Poolnum` | Numeric | Person and physical unit identifiers. |
| `TransDt`, `TransDate` | Numeric | Recorded transfusion datetime and date. |
| `XProdType` | Character | Component type used to select red cell units. |
| `DonDate` | Numeric | Donation timestamp, interpreted as a SAS datetime. |
| `Storage`, `DonorHb`, `DonorSex`, `DonorParity` | Numeric | Recorded unit storage duration and donor hemoglobin concentration, sex and parity used in analyses of blood unit characteristics. |

Eligibility and sensitivity analyses require transfusion history before and after index events. The preparation code groups simultaneous units and checks that the category used in each analysis of a blood unit characteristic is defined consistently across them. Donor parity comes from the recorded binary field and is analyzed among female donors.

## Admission history

| Variables | SAS type | Use |
| --- | --- | --- |
| `StudyID`, `PatientID` | Numeric | Person and recorded clinical/admission identifiers. |
| `AdmissionTime`, `DischargeTime` | Character | Recorded boundaries parsed to SAS datetimes during preparation. |

The [cohort code](code/cohort.sas) defines how admission times are parsed, how events are assigned to an admission and how ambiguous histories are handled.

## Transfusion record coverage

| Variable | SAS type | Use |
| --- | --- | --- |
| `PersonKey` | Numeric | Person identifier shared with the prepared events, derived from `StudyID`. |
| `CoverageStart` | Numeric | Start of coverage, inclusive, as a SAS datetime. |
| `CoverageEnd` | Numeric | End of coverage, exclusive, as a SAS datetime. |

For this study, each person's coverage interval ran from 1 January 1973 up to, but excluding, 1 January 2019. The cohort with no further recorded RBC transfusion within 12 hours required coverage through hour 12 after each eligible start. The search included a new transfusion starting exactly at hour 12.
