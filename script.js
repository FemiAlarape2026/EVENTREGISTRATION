const steps = document.querySelectorAll(".form-step");

const nextBtn = document.querySelector(".next-btn");
const prevBtn = document.querySelector(".prev-btn");

const progress = document.getElementById("progress");

const academicLevel = document.getElementById("academicLevel");

const ugFields = document.getElementById("ugFields");
const pgFields = document.getElementById("pgFields");

const matric = document.getElementById("matric");
const dob = document.getElementById("dob");

const matricError = document.getElementById("matricError");
const dobError = document.getElementById("dobError");

const form = document.getElementById("registrationForm");

const successMessage = document.getElementById("successMessage");

let currentStep = 0;


/* =========================
   CHANGE FORM BASED ON LEVEL
========================= */

academicLevel.addEventListener("change", () => {

    if (academicLevel.value === "UG") {

        ugFields.classList.remove("hidden");
        pgFields.classList.add("hidden");
    }

    else if (academicLevel.value === "PG") {

        pgFields.classList.remove("hidden");
        ugFields.classList.add("hidden");
    }

});


/* =========================
   NEXT BUTTON
========================= */

nextBtn.addEventListener("click", () => {

    let validMatric = validateMatric();
    let validDOB = validateDOB();

    if (!validMatric || !validDOB) {
        return;
    }

    steps[currentStep].classList.remove("active");

    currentStep++;

    steps[currentStep].classList.add("active");

    progress.style.width = "100%";
});


/* =========================
   PREVIOUS BUTTON
========================= */

prevBtn.addEventListener("click", () => {

    steps[currentStep].classList.remove("active");

    currentStep--;

    steps[currentStep].classList.add("active");

    progress.style.width = "50%";
});


/* =========================
   MATRIC VALIDATION
========================= */

function validateMatric() {

    let year = new Date().getFullYear();

    let ugPattern = new RegExp(`^UG${year}\\d{4}$`);

    let pgPattern = new RegExp(`^PG${year}\\d{4}$`);

    let value = matric.value.trim();

    if (academicLevel.value === "UG") {

        if (!ugPattern.test(value)) {

            matricError.innerText =
            `Format should be UG${year}1234`;

            return false;
        }
    }

    else if (academicLevel.value === "PG") {

        if (!pgPattern.test(value)) {

            matricError.innerText =
            `Format should be PG${year}1234`;

            return false;
        }
    }

    matricError.innerText = "";

    return true;
}


/* =========================
   DOB VALIDATION
========================= */

function validateDOB() {

    let birthDate = new Date(dob.value);

    let today = new Date();

    let age =
    today.getFullYear() -
    birthDate.getFullYear();

    if (academicLevel.value === "UG") {

        if (age >= 25) {

            dobError.innerText =
            "UG students must be below 25.";

            return false;
        }
    }

    else if (academicLevel.value === "PG") {

        if (age < 22) {

            dobError.innerText =
            "PG students must be at least 22.";

            return false;
        }
    }

    dobError.innerText = "";

    return true;
}


/* =========================
   LOAD DEPARTMENTS
========================= */

async function loadDepartments() {

    try {

        const response =
        await fetch("departments.json");

        const data =
        await response.json();

        const departmentSelect =
        document.getElementById("department");

        departmentSelect.innerHTML =
        "<option>Select Department</option>";

        data.departments.forEach(dept => {

            let option =
            document.createElement("option");

            option.value = dept;

            option.textContent = dept;

            departmentSelect.appendChild(option);
        });

    }

    catch(error) {

        console.log(
            "Error loading departments",
            error
        );
    }
}

loadDepartments();


/* =========================
   FORM SUBMISSION
========================= */

form.addEventListener("submit", (e) => {

    e.preventDefault();

    successMessage.innerHTML =
    "Registration completed successfully!";

    successMessage.style.display = "block";

    form.reset();

    ugFields.classList.add("hidden");

    pgFields.classList.add("hidden");

    steps[currentStep].classList.remove("active");

    currentStep = 0;

    steps[currentStep].classList.add("active");

    progress.style.width = "50%";

});